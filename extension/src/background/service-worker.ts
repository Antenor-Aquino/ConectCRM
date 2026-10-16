// Service worker: cria o documento offscreen (dono do banco) sob demanda e
// dispara os lembretes de tarefas (notificação do Chrome, mesmo com o CRM fechado).
import type { Activity } from "../db/activities";
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

async function checkReminders(): Promise<void> {
  const userId = ((await chrome.storage.local.get("conectcrm-current-user"))["conectcrm-current-user"] as string | undefined) ?? null;
  const due = await rpc<Activity[]>("activities.dueReminders", {}, userId);
  if (due.length === 0) return;
  for (const a of due) {
    const when = new Date(a.due_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    chrome.notifications.create(`task:${a.id}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `Lembrete: ${a.title}`,
      message: `Tarefa às ${when}${a.meeting_url ? " · reunião online" : ""}`,
      priority: 2,
      requireInteraction: true,
    });
  }
  await rpc("activities.markReminded", { ids: due.map((a) => a.id) }, userId);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void checkReminders().catch((e) => console.warn("Lembretes:", e));
});

// Clique na notificação: abre (ou foca) o CRM já na tarefa.
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("task:")) return;
  const url = chrome.runtime.getURL(`${DASHBOARD}?tarefa=${notificationId.slice(5)}`);
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
