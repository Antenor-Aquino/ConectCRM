// Central de notificações (portada da gestao-financeira-extensao): avisos de
// processos sem interação direta (backup automático, lembretes, importações).
// Ficam em chrome.storage.local deste computador. "Limpar tudo" no sino só
// esconde (cleared); o histórico continua até sair do limite.
export type NotificationKind = "success" | "error" | "info";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  cleared: boolean;
}

export const NOTIFICATIONS_KEY = "conectcrm-notifications";
const MAX_STORED = 200;

export async function listNotifications(): Promise<AppNotification[]> {
  return ((await chrome.storage.local.get(NOTIFICATIONS_KEY))[NOTIFICATIONS_KEY] as AppNotification[] | undefined) ?? [];
}

export async function addNotification(input: { kind: NotificationKind; title: string; message: string }): Promise<void> {
  const next: AppNotification = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), read: false, cleared: false, ...input };
  await chrome.storage.local.set({ [NOTIFICATIONS_KEY]: [next, ...(await listNotifications())].slice(0, MAX_STORED) });
}

export async function markAllRead(): Promise<void> {
  await chrome.storage.local.set({ [NOTIFICATIONS_KEY]: (await listNotifications()).map((n) => ({ ...n, read: true })) });
}

export async function clearNotifications(): Promise<void> {
  await chrome.storage.local.set({ [NOTIFICATIONS_KEY]: (await listNotifications()).map((n) => ({ ...n, read: true, cleared: true })) });
}
