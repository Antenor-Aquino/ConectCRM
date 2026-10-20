// Service worker: cria o documento offscreen (dono do banco) sob demanda e
// dispara os lembretes de tarefas (notificação do Chrome, mesmo com o CRM fechado).
import { listAllFromCrm, loadGfSettings, pushPendingContactsVia } from "../lib/finance/gfBridge";
import type { NotifyJob } from "../db/notifications";
import { sendMail } from "../lib/calendar";
import { sendCallMeBot } from "../lib/notify/callmebot";
import { sendViaWhatsAppWeb } from "../lib/notify/waweb";
import { loadSenders, zapiSendText } from "../lib/whatsappSenders";
import { CHANNEL_LABEL, activeSettings, loadAllNotifySettings, loadMailSender, withDefaults, type Channel } from "../lib/notify/settings";
import { addNotification } from "../lib/notifications";
import { runClip, type ClipStartMessage } from "./clip";
import { OFFSCREEN_PATH, type EnsureOffscreenMessage, type RpcRequest, type RpcResponse } from "../rpc/protocol";

let creating: Promise<void> | null = null;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.LOCAL_STORAGE],
        justification: "Mantém o banco SQLite local do CRM aberto para todas as telas da extensão.",
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

chrome.runtime.onMessage.addListener((msg: EnsureOffscreenMessage, _sender, sendResponse) => {
  if (msg?.target !== "background" || msg.kind !== "ensure-offscreen") return false;
  ensureOffscreen()
    .then(() => sendResponse({ ok: true }))
    .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
  return true;
});

// Recorte de tela pedido pelo popup do WhatsApp.
chrome.runtime.onMessage.addListener((msg: ClipStartMessage, _sender, sendResponse) => {
  if (msg?.target !== "background" || msg.kind !== "clip-start") return false;
  void runClip().then(sendResponse);
  return true;
});

// ---------- Lembretes ----------

const ALARM = "conectcrm-reminders";
const DASHBOARD = "src/dashboard/dashboard.html";

function scheduleAlarm(): void {
  void chrome.alarms.get(ALARM).then((a) => {
    if (!a) void chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  });
}

async function rpc<T>(method: string, params: unknown, userId: string | null): Promise<T> {
  await ensureOffscreen();
  const req: RpcRequest = { target: "offscreen", kind: "rpc", method, params, userId };
  for (let attempt = 0; ; attempt++) {
    try {
      const res = (await chrome.runtime.sendMessage(req)) as RpcResponse | undefined;
      if (!res) throw new Error("sem resposta");
      if (!res.ok) throw new Error(res.error);
      return res.result as T;
    } catch (err) {
      if (attempt >= 10) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

// Lembretes e avisos (spec 10): a cada minuto pergunta ao banco o que avisar,
// envia por Chrome, e-mail (Gmail/Outlook) e WhatsApp (CallMeBot) e registra
// o resultado (falhas tentam de novo; a última vira aviso no sino).
let running = false;
const SNOOZE_KEY = "conectcrm-snoozes";
type Snooze = { activityId: string; at: string; title: string; text: string };

function chromeNotify(id: string, title: string, message: string, withButtons: boolean): void {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
    priority: 2,
    requireInteraction: true,
    ...(withButtons ? { buttons: [{ title: "Concluir" }, { title: "Adiar 10 min" }] } : {}),
  });
}

// Cópia dos lançamentos da Gestão Financeira (spec 13): lida a cada 3 h, para
// os alertas financeiros do resumo diário. Sem ela por perto, fica a última.
const FINANCE_SYNC_KEY = "conectcrm-finance-bg-sync";
async function refreshFinanceCopy(userId: string | null): Promise<void> {
  // Paridade de cadastros: contatos/organizações alterados vão a cada passada (modo direto).
  try {
    const gf = await loadGfSettings();
    if (gf.gfId && gf.direct)
      await pushPendingContactsVia(gf.gfId, {
        pending: () => rpc("finance.pendingContacts", {}, userId),
        sent: (crmRefs) => rpc("finance.contactsSent", { crmRefs }, userId),
      });
  } catch {
    // Fica pendente para a próxima.
  }
  try {
    const last = (await chrome.storage.local.get(FINANCE_SYNC_KEY))[FINANCE_SYNC_KEY] as number | undefined;
    if (last && Date.now() - last < 3 * 3600_000) return;
    const gf = await loadGfSettings();
    if (!gf.gfId || !gf.direct) return;
    await chrome.storage.local.set({ [FINANCE_SYNC_KEY]: Date.now() });
    const r = await listAllFromCrm(gf.gfId, () => rpc<string[]>("finance.cardIds", {}, userId));
    await rpc("finance.replaceAll", { items: r.items, env: r.env, at: r.at }, userId);
  } catch {
    // Gestão Financeira fechada/desatualizada: o resumo usa a última cópia.
  }
}

async function runNotifications(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const userId = ((await chrome.storage.local.get("conectcrm-current-user"))["conectcrm-current-user"] as string | undefined) ?? null;
    // Adiados ("Adiar 10 min") que venceram.
    const snoozes = ((await chrome.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY] as Snooze[] | undefined) ?? [];
    const due = snoozes.filter((x) => x.at <= new Date().toISOString());
    if (due.length) {
      await chrome.storage.local.set({ [SNOOZE_KEY]: snoozes.filter((x) => !due.includes(x)) });
      for (const x of due) chromeNotify(`task:${x.activityId}`, x.title, x.text, true);
    }
    await refreshFinanceCopy(userId);
    const settings = Object.fromEntries(Object.entries(await loadAllNotifySettings()).map(([id, x]) => [id, activeSettings(x)]));
    const jobs = await rpc<NotifyJob[]>("notifications.plan", { settings }, userId);
    if (!jobs.length) return;
    const sender = await loadMailSender();
    const results = [];
    for (const job of jobs) {
      const s = withDefaults(settings[job.userId ?? ""]);
      let error: string | undefined;
      try {
        if (job.channel === "chrome") {
          const [title, ...rest] = job.text.split("\n");
          chromeNotify(
            job.activityId && job.kind !== "missed" ? `task:${job.activityId}` : `notify:${job.key}`,
            job.title,
            rest.join("\n") || title || "",
            job.kind === "reminder",
          );
          await addNotification({ kind: job.kind === "overdue" ? "error" : "info", title: job.title, message: rest.join(" · ") });
        } else if (job.channel === "email") {
          if (!sender) throw new Error("Conecte a conta que envia os e-mails em Configurações → Notificações.");
          await sendMail(sender.provider, { to: s.email.to, subject: job.subject, html: job.html });
        } else {
          if (s.whatsapp.via === "web") await sendViaWhatsAppWeb(s.whatsapp.phone, job.text);
          else if (s.whatsapp.via === "zapi") {
            const zs = (await loadSenders(job.userId ?? "")).senders.find((x) => x.id === s.whatsapp.senderId);
            if (!zs?.zapi) throw new Error("O número da Z-API dos lembretes não existe mais em Configurações → WhatsApp.");
            await zapiSendText(zs.zapi, s.whatsapp.phone, job.text);
          } else await sendCallMeBot(s.whatsapp.phone, s.whatsapp.apikey, job.text);
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      results.push({ key: job.key, channel: job.channel, kind: job.kind, userId: job.userId, activityId: job.activityId, title: job.title, ok: !error, error });
    }
    const { finalFailures } = await rpc<{ finalFailures: { title: string; channel: string; error: string }[] }>("notifications.record", { results }, userId);
    for (const f of finalFailures)
      await addNotification({ kind: "error", title: `Não foi possível avisar por ${CHANNEL_LABEL[f.channel as Channel]}`, message: `${f.title}: ${f.error}` });
  } finally {
    running = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runNotifications().catch((e) => console.warn("Notificações:", e));
});

// Botões da notificação do lembrete: Concluir / Adiar 10 min.
chrome.notifications.onButtonClicked.addListener((notificationId, button) => {
  if (!notificationId.startsWith("task:")) return;
  const activityId = notificationId.slice(5);
  chrome.notifications.clear(notificationId);
  void (async () => {
    const userId = ((await chrome.storage.local.get("conectcrm-current-user"))["conectcrm-current-user"] as string | undefined) ?? null;
    if (button === 0) {
      await rpc("activities.setDone", { id: activityId, done: true }, userId);
      return;
    }
    const a = await rpc<{ title: string; due_at: string } | null>("activities.get", { id: activityId }, userId);
    if (!a) return;
    const snoozes = ((await chrome.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY] as Snooze[] | undefined) ?? [];
    const when = new Date(a.due_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    snoozes.push({ activityId, at: new Date(Date.now() + 10 * 60_000).toISOString(), title: `Lembrete: ${a.title}`, text: `Atividade às ${when} (adiado)` });
    await chrome.storage.local.set({ [SNOOZE_KEY]: snoozes });
  })().catch((e) => console.warn("Notificação:", e));
});

// Clique na notificação: abre (ou foca) o CRM já na tarefa.
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("task:") && !notificationId.startsWith("notify:")) return;
  const query = notificationId.startsWith("task:") ? `?tarefa=${notificationId.slice(5)}` : "";
  const url = chrome.runtime.getURL(`${DASHBOARD}${query}`);
  void chrome.tabs.query({ url: chrome.runtime.getURL(`${DASHBOARD}*`) }).then(async (tabs) => {
    const tab = tabs[0];
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url, active: true });
      if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    } else await chrome.tabs.create({ url });
    chrome.notifications.clear(notificationId);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreen();
  scheduleAlarm();
});
chrome.runtime.onStartup.addListener(scheduleAlarm);
scheduleAlarm();
