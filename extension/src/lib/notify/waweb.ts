// WhatsApp pelo WhatsApp Web aberto neste Chrome (spec 10): a mensagem sai do
// número conectado no WhatsApp Web e vai para o número indicado pelo usuário.
// Usa a biblioteca WA-JS (public/vendor/wppconnect-wa.js), injetada na aba do
// WhatsApp, que envia sem abrir a conversa (não atrapalha quem está usando).
const WA_URL = "https://web.whatsapp.com/*";
const LIB = "vendor/wppconnect-wa.js";

/** "(41) 99999-8888" → "5541999998888" (sem o 55, assume Brasil). */
export function waDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length <= 11 ? `55${d}` : d;
}

type SendResult = { ok: true } | { ok: false; code: "not-ready" | "not-auth" | "not-on-whatsapp" | "self" | "error"; message?: string };

const ERRORS: Record<Exclude<SendResult, { ok: true }>["code"], string> = {
  "not-ready": "o WhatsApp Web não terminou de carregar. Deixe a aba aberta e conectada.",
  "not-auth": "o WhatsApp Web não está conectado ou ainda está carregando. Abra a aba e confira se aparece a lista de conversas (sem o QR Code).",
  "not-on-whatsapp": "o número indicado não tem WhatsApp. Confira o DDD e o número.",
  self: "o número indicado é o mesmo do WhatsApp Web; mensagem para você mesmo não toca no celular. Indique outro número.",
  error: "não foi possível enviar.",
};

// ---- Funções que rodam DENTRO da aba do WhatsApp (mundo da página) ----

function waConfigure(): boolean {
  const w = window as unknown as { WPP?: unknown; WPPConfig?: unknown };
  if (w.WPP) return true;
  // Sem nome de aparelho próprio e sem estatísticas da biblioteca.
  w.WPPConfig = { deviceName: false, disableGoogleAnalytics: true, googleAnalyticsId: null, linkPreviewApiServers: null, poweredBy: null };
  return false;
}

async function waSend(digits: string, text: string, waitMs: number): Promise<SendResult> {
  type Wid = { _serialized?: string; toString(): string; user?: string };
  const WPP = (window as unknown as { WPP?: any }).WPP; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!WPP) return { ok: false, code: "not-ready" };
  const until = Date.now() + waitMs;
  while (!WPP.isFullReady && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  if (!WPP.isFullReady) {
    let auth: boolean | undefined;
    try {
      auth = WPP.conn?.isAuthenticated?.();
    } catch {
      // Módulos internos ainda não carregados: tela do QR Code ou carregando.
    }
    return { ok: false, code: auth === true ? "not-ready" : "not-auth" };
  }
  try {
    if (!WPP.conn.isAuthenticated()) return { ok: false, code: "not-auth" };
    const me = WPP.conn.getMyUserId() as Wid | undefined;
    const found = (await WPP.contact.queryWidExists(`${digits}@c.us`)) as { wid: Wid } | null;
    if (!found) return { ok: false, code: "not-on-whatsapp" };
    const id = found.wid._serialized ?? found.wid.toString();
    if (me && (me._serialized ?? me.toString()) === id) return { ok: false, code: "self" };
    await WPP.chat.sendTextMessage(id, text, { createChat: true, linkPreview: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

// ---- Lado da extensão ----

async function whatsappTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ url: WA_URL });
  const tab = tabs.find((t) => !t.discarded) ?? tabs[0];
  if (!tab?.id) throw new Error("WhatsApp Web: abra o web.whatsapp.com neste Chrome e deixe a aba aberta e conectada.");
  if (tab.discarded || tab.status !== "complete") {
    // Aba suspensa pelo Chrome (economia de memória): recarrega e espera.
    if (tab.discarded) await chrome.tabs.reload(tab.id);
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      const t = await chrome.tabs.get(tab.id);
      if (t.status === "complete" && !t.discarded) return t;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return tab;
}

/** Envia `text` para `phone` pelo WhatsApp Web aberto neste Chrome. */
export async function sendViaWhatsAppWeb(phone: string, text: string, waitMs = 30_000): Promise<void> {
  const digits = waDigits(phone);
  if (digits.length < 12) throw new Error("WhatsApp Web: informe o número com DDD.");
  const tab = await whatsappTab();
  const target = { tabId: tab.id! };
  try {
    const [cfg] = await chrome.scripting.executeScript({ target, world: "MAIN", func: waConfigure });
    if (!cfg?.result) await chrome.scripting.executeScript({ target, world: "MAIN", files: [LIB] });
  } catch (e) {
    throw new Error(`WhatsApp Web: não foi possível acessar a aba (${e instanceof Error ? e.message : String(e)}).`);
  }
  const [res] = await chrome.scripting.executeScript({ target, world: "MAIN", func: waSend, args: [digits, text, waitMs] });
  const r = res?.result as SendResult | undefined;
  if (r?.ok) return;
  const code = r && !r.ok ? r.code : "error";
  throw new Error(`WhatsApp Web: ${ERRORS[code]}${r && !r.ok && r.message ? ` (${r.message})` : ""}`);
}
