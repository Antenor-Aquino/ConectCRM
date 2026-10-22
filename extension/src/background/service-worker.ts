// Service worker: cria o documento offscreen (dono do banco) sob demanda e
// dispara os lembretes de tarefas (notificação do Chrome, mesmo com o CRM fechado).
import { gfIntegrationActive, listAllFromCrm, loadGfSettings, pushPendingContactsVia } from "../lib/finance/gfBridge";
import type { NotifyJob } from "../db/notifications";
import { sendMail } from "../lib/calendar";
import { sendCallMeBot } from "../lib/notify/callmebot";
import { sendViaWhatsAppWeb } from "../lib/notify/waweb";
import { loadSenders, zapiSendText } from "../lib/whatsappSenders";
import { CHANNEL_LABEL, activeSettings, loadAllNotifySettings, loadMailSender, withDefaults, type Channel } from "../lib/notify/settings";
import { addNotification } from "../lib/notifications";
import { loadSoundSettings, soundFor, type PlaySoundMessage, type SoundCategory } from "../lib/notify/sounds";
import { ALERTS_KEY, ALERT_PAGE, ALERT_WINDOW_KEY, type AlertActionMessage, type AlertItem } from "../lib/notify/alerts";
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

function chromeNotify(id: string, title: string, message: string, withButtons: boolean, category: SoundCategory = "reminder"): void {
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
    priority: 2,
    requireInteraction: true,
    // O som é o escolhido em Configurações → Notificações → Som (tocado abaixo), não o do sistema.
    silent: true,
    ...(withButtons ? { buttons: [{ title: "Concluir" }, { title: "Adiar 10 min" }] } : {}),
  });
  void notifySound(id, category).catch((e) => console.warn("Som da notificação:", e));
  void showAlert({ id, title, message, task: withButtons, at: new Date().toISOString() }).catch((e) => console.warn("Janela de aviso:", e));
}

// ---------- Janela de aviso ----------
// O balão do Chrome depende do sistema: com as notificações do Chrome desligadas
// no Windows/macOS ou com "Não perturbe", ele não aparece (e o som toca do mesmo
// jeito). Por isso o aviso também abre numa janelinha do CRM, que fica até a
// pessoa agir (Concluir, Adiar, Abrir ou OK).

async function showAlert(alert: AlertItem): Promise<void> {
  if (!(await loadSoundSettings()).window) return;
  const list = ((await chrome.storage.session.get(ALERTS_KEY))[ALERTS_KEY] as AlertItem[] | undefined) ?? [];
  await chrome.storage.session.set({ [ALERTS_KEY]: [...list.filter((a) => a.id !== alert.id), alert] });
  const winId = (await chrome.storage.session.get(ALERT_WINDOW_KEY))[ALERT_WINDOW_KEY] as number | undefined;
  if (winId != null) {
    const ok = await chrome.windows.update(winId, { focused: true, drawAttention: true }).then(
      () => true,
      () => false,
    );
    if (ok) return;
  }
  const width = 400;
  const height = 460;
  const base = await chrome.windows.getLastFocused().catch(() => null);
  const left = base?.left != null && base.width ? Math.max(0, base.left + base.width - width - 24) : undefined;
  const top = base?.top != null && base.height ? Math.max(0, base.top + base.height - height - 24) : undefined;
  const url = chrome.runtime.getURL(ALERT_PAGE);
  // No canto da janela do Chrome; se o Chrome recusar a posição (outro monitor, tela pequena), deixa ele escolher.
  const win = await chrome.windows
    .create({ url, type: "popup", width, height, left, top, focused: true })
    .catch(() => chrome.windows.create({ url, type: "popup", width, height, focused: true }));
  if (win?.id != null) await chrome.storage.session.set({ [ALERT_WINDOW_KEY]: win.id });
}

async function dropAlert(id: string): Promise<void> {
  const list = ((await chrome.storage.session.get(ALERTS_KEY))[ALERTS_KEY] as AlertItem[] | undefined) ?? [];
  const next = list.filter((a) => a.id !== id);
  await chrome.storage.session.set({ [ALERTS_KEY]: next });
  if (!next.length) {
    const winId = (await chrome.storage.session.get(ALERT_WINDOW_KEY))[ALERT_WINDOW_KEY] as number | undefined;
    if (winId != null) await chrome.windows.remove(winId).catch(() => {});
  }
}

chrome.windows.onRemoved.addListener((winId) => {
  void chrome.storage.session.get(ALERT_WINDOW_KEY).then(async (r) => {
    if (r[ALERT_WINDOW_KEY] !== winId) return;
    // Fechou a janela no X: os avisos dela ficam vistos (o som para de repetir).
    const list = ((await chrome.storage.session.get(ALERTS_KEY))[ALERTS_KEY] as AlertItem[] | undefined) ?? [];
    for (const a of list) chrome.notifications.clear(a.id);
    await chrome.storage.session.set({ [ALERTS_KEY]: [], [ALERT_WINDOW_KEY]: null });
  });
});

// ---------- Som ----------

const REPEAT_KEY = "conectcrm-sound-repeat";
type Repeat = { id: string; category: SoundCategory; left: number };

async function playCategory(category: SoundCategory): Promise<boolean> {
  const s = await loadSoundSettings();
  const sound = soundFor(s, category);
  if (!sound) return false;
  await ensureOffscreen();
  const r = (await chrome.runtime.sendMessage({ target: "offscreen", kind: "play-sound", sound, volume: s.volume } satisfies PlaySoundMessage)) as
    | { ok: boolean; error?: string }
    | undefined;
  // Último som tocado (diagnóstico).
  await chrome.storage.session.set({ "conectcrm-sound-last": { at: new Date().toISOString(), sound, ok: !!r?.ok, error: r?.error ?? null } });
  return s.repeat;
}

async function notifySound(id: string, category: SoundCategory): Promise<void> {
  const repeat = await playCategory(category);
  if (!repeat) return;
  const list = ((await chrome.storage.session.get(REPEAT_KEY))[REPEAT_KEY] as Repeat[] | undefined) ?? [];
  await chrome.storage.session.set({ [REPEAT_KEY]: [...list.filter((r) => r.id !== id), { id, category, left: 3 }] });
}

/** A cada minuto: toca de novo os avisos ainda na tela (até 3 vezes). */
async function repeatSounds(): Promise<void> {
  const list = ((await chrome.storage.session.get(REPEAT_KEY))[REPEAT_KEY] as Repeat[] | undefined) ?? [];
  if (!list.length) return;
  const open = await new Promise<Record<string, boolean>>((resolve) => chrome.notifications.getAll((n) => resolve(n as Record<string, boolean>)));
  const next: Repeat[] = [];
  let played = false;
  for (const r of list) {
    if (!open[r.id] || r.left <= 0) continue;
    if (!played) {
      await playCategory(r.category);
      played = true;
    }
    if (r.left > 1) next.push({ ...r, left: r.left - 1 });
  }
  await chrome.storage.session.set({ [REPEAT_KEY]: next });
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
    // Alertas financeiros do resumo diário só com a integração com a Gestão Financeira ativada.
    const finance = gfIntegrationActive(await loadGfSettings());
    const jobs = await rpc<NotifyJob[]>("notifications.plan", { settings, finance }, userId);
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
            job.kind === "overdue" ? "overdue" : job.kind === "digest" ? "digest" : "reminder",
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
  if (alarm.name === ALARM) {
    void runNotifications().catch((e) => console.warn("Notificações:", e));
    void repeatSounds().catch((e) => console.warn("Som da notificação:", e));
  }
});

/** Concluir / Adiar 10 min (botões do balão e da janela de aviso). */
async function taskAction(notificationId: string, action: "done" | "snooze"): Promise<void> {
  const activityId = notificationId.slice(5);
  chrome.notifications.clear(notificationId);
  await dropAlert(notificationId);
  {
    const userId = ((await chrome.storage.local.get("conectcrm-current-user"))["conectcrm-current-user"] as string | undefined) ?? null;
    if (action === "done") {
      await rpc("activities.setDone", { id: activityId, done: true }, userId);
      return;
    }
    const a = await rpc<{ title: string; due_at: string } | null>("activities.get", { id: activityId }, userId);
    if (!a) return;
    const snoozes = ((await chrome.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY] as Snooze[] | undefined) ?? [];
    const when = new Date(a.due_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    snoozes.push({ activityId, at: new Date(Date.now() + 10 * 60_000).toISOString(), title: `Lembrete: ${a.title}`, text: `Atividade às ${when} (adiado)` });
    await chrome.storage.local.set({ [SNOOZE_KEY]: snoozes });
  }
}

chrome.notifications.onButtonClicked.addListener((notificationId, button) => {
  if (!notificationId.startsWith("task:")) return;
  void taskAction(notificationId, button === 0 ? "done" : "snooze").catch((e) => console.warn("Notificação:", e));
});

/** Abre (ou foca) o CRM; na tarefa, quando o aviso é de uma. */
async function openFromAlert(notificationId: string): Promise<void> {
  const query = notificationId.startsWith("task:") ? `?tarefa=${notificationId.slice(5)}` : "";
  const url = chrome.runtime.getURL(`${DASHBOARD}${query}`);
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL(`${DASHBOARD}*`) });
  const tab = tabs[0];
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { url, active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
  chrome.notifications.clear(notificationId);
  await dropAlert(notificationId);
}

// Ações da janela de aviso (src/alert).
chrome.runtime.onMessage.addListener((msg: AlertActionMessage, _sender, sendResponse) => {
  if (msg?.target !== "background" || msg.kind !== "alert-action") return false;
  const run =
    msg.action === "open"
      ? openFromAlert(msg.id)
      : msg.action === "ok"
        ? (chrome.notifications.clear(msg.id), dropAlert(msg.id))
        : msg.action === "test"
          ? Promise.resolve(chromeNotify(`notify:teste-${Date.now()}`, "Teste de aviso do ConectCRM", "Se você está vendo isto, os avisos estão funcionando.", false))
          : taskAction(msg.id, msg.action);
  void Promise.resolve(run)
    .then(() => sendResponse({ ok: true }))
    .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// Clique na notificação: abre (ou foca) o CRM já na tarefa.
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("task:") && !notificationId.startsWith("notify:")) return;
  void openFromAlert(notificationId);
});
// Fechou o balão: sai da janela de aviso também.
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  if (byUser) void dropAlert(notificationId);
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreen();
  scheduleAlarm();
});
chrome.runtime.onStartup.addListener(scheduleAlarm);
scheduleAlarm();
