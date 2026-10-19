// Números de WhatsApp de origem (Configurações → WhatsApp): cada usuário
// cadastra os números de onde envia (ex.: "Comercial", "Suporte") e escolhe um
// na hora de enviar. Ficam neste computador (chrome.storage.local), como os
// provedores de e-mail; a chave da Z-API não vai para o backup.
//
// Formas de envio:
// - "web": WhatsApp Web aberto neste Chrome (automático; um por perfil do Chrome);
// - "manual": o CRM prepara (baixa o arquivo, copia a mensagem e o link da
//   conversa) e o usuário envia no outro perfil/aparelho;
// - "zapi": API da Z-API (automático, com o Chrome em qualquer perfil).
import { waDigits } from "./notify/waweb";

export type SenderVia = "web" | "manual" | "zapi";
export const SENDER_VIA_LABEL: Record<SenderVia, string> = {
  web: "WhatsApp Web deste Chrome",
  manual: "Manual (outro perfil do Chrome ou celular)",
  zapi: "Z-API",
};

export interface ZapiCredentials {
  instanceId: string;
  token: string;
  /** "Client-Token" da conta (Z-API → Segurança). */
  clientToken: string;
}

export interface WhatsAppSender {
  id: string;
  /** "Comercial", "Suporte"… */
  name: string;
  phone: string;
  via: SenderVia;
  zapi?: ZapiCredentials;
}

export const ZAPI_ORIGIN = "https://api.z-api.io/*";
export const ZAPI_HELP = "https://developer.z-api.io/";
const ZAPI_BASE = "https://api.z-api.io/instances";

const KEY = "conectcrm-whatsapp-senders";
type Stored = Record<string, { senders: WhatsAppSender[]; lastId?: string }>;

async function loadAll(): Promise<Stored> {
  return ((await chrome.storage.local.get(KEY))[KEY] as Stored | undefined) ?? {};
}

export async function loadSenders(userId: string): Promise<{ senders: WhatsAppSender[]; lastId?: string }> {
  return (await loadAll())[userId] ?? { senders: [] };
}

export async function saveSenders(userId: string, senders: WhatsAppSender[]): Promise<void> {
  const all = await loadAll();
  await chrome.storage.local.set({ [KEY]: { ...all, [userId]: { ...all[userId], senders } } });
}

/** Lembra o último número usado (vem escolhido no próximo envio). */
export async function rememberSender(userId: string, id: string): Promise<void> {
  const all = await loadAll();
  await chrome.storage.local.set({ [KEY]: { ...all, [userId]: { senders: all[userId]?.senders ?? [], lastId: id } } });
}

/** Sem nenhum número cadastrado, o envio usa o WhatsApp Web deste Chrome (como antes). */
export const IMPLICIT_WEB_SENDER: WhatsAppSender = { id: "web", name: "WhatsApp Web deste Chrome", phone: "", via: "web" };

export function senderLabel(s: WhatsAppSender): string {
  return s.phone ? `${s.name} · ${s.phone}` : s.name;
}

/** Mesmo número? Compara DDD e os 8 últimos dígitos (celular com ou sem o 9). */
export function sameNumber(a: string, b: string): boolean {
  const x = waDigits(a);
  const y = waDigits(b);
  if (x === y) return true;
  const tail = (d: string) => d.slice(-8);
  const ddd = (d: string) => (d.startsWith("55") ? d.slice(2, 4) : d.slice(0, -8));
  return tail(x) === tail(y) && ddd(x) === ddd(y);
}

// ---------- Z-API ----------

export async function askZapiPermission(): Promise<boolean> {
  if (!chrome.permissions?.request) return true;
  if (await chrome.permissions.contains({ origins: [ZAPI_ORIGIN] })) return true;
  return chrome.permissions.request({ origins: [ZAPI_ORIGIN] });
}

async function zapi<T>(c: ZapiCredentials, path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<T> {
  if (!c.instanceId.trim() || !c.token.trim()) throw new Error("Z-API: informe a instância e o token.");
  let res: Response;
  try {
    res = await fetchFn(`${ZAPI_BASE}/${encodeURIComponent(c.instanceId.trim())}/token/${encodeURIComponent(c.token.trim())}/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(c.clientToken.trim() ? { "Client-Token": c.clientToken.trim() } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("Z-API: sem conexão (internet ou permissão de acesso à Z-API).");
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok || json.error) {
    const why = json.message || json.error || `erro ${res.status}`;
    if (res.status === 401 || res.status === 403 || /token/i.test(why)) throw new Error(`Z-API: instância, token ou Client-Token inválido (${why}).`);
    throw new Error(`Z-API: ${why}`);
  }
  return json;
}

/** Instância conectada ao WhatsApp? */
export async function zapiStatus(c: ZapiCredentials, fetchFn?: typeof fetch): Promise<{ connected: boolean; error?: string }> {
  return zapi<{ connected: boolean; error?: string }>(c, "status", undefined, fetchFn);
}

export async function zapiSendText(c: ZapiCredentials, phone: string, message: string, fetchFn?: typeof fetch): Promise<void> {
  await zapi(c, "send-text", { phone: waDigits(phone), message }, fetchFn);
}

/** Arquivo em data URL; imagem vai como foto, o resto como documento. */
export async function zapiSendFile(
  c: ZapiCredentials,
  phone: string,
  file: { dataUrl: string; filename: string; mime: string },
  caption: string,
  fetchFn?: typeof fetch,
): Promise<void> {
  if (/^image\/(png|jpe?g|webp)$/.test(file.mime)) {
    await zapi(c, "send-image", { phone: waDigits(phone), image: file.dataUrl, caption: caption || undefined }, fetchFn);
    return;
  }
  const ext = (file.filename.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "pdf").toLowerCase();
  await zapi(
    c,
    `send-document/${ext}`,
    { phone: waDigits(phone), document: file.dataUrl, fileName: file.filename.replace(/\.[^.]+$/, ""), caption: caption || undefined },
    fetchFn,
  );
}
