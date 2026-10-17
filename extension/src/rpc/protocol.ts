// Mensagens entre telas (dashboard/popup), service worker e offscreen.
export const OFFSCREEN_PATH = "src/offscreen/offscreen.html";

export interface EnsureOffscreenMessage {
  target: "background";
  kind: "ensure-offscreen";
}

export interface RpcRequest {
  target: "offscreen";
  kind: "rpc";
  method: string;
  params: unknown;
  userId: string | null;
}

export type RpcResponse = { ok: true; result: unknown } | { ok: false; error: string };

/** Popup → aba do CRM já aberta: abrir um cartão nela (ver dashboard/App). */
export interface OpenCardMessage {
  target: "dashboard";
  kind: "open-card";
  tabId: number;
  cardId: string;
}
