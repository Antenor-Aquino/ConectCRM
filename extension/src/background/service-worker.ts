// Service worker: cria o documento offscreen (dono do banco) sob demanda.
import { OFFSCREEN_PATH, type EnsureOffscreenMessage } from "../rpc/protocol";

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

chrome.runtime.onInstalled.addListener(() => {
  void ensureOffscreen();
});
