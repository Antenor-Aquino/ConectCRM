// Links de contato: telefone → conversa no WhatsApp Web; e-mail → provedor de
// e-mail do usuário (Configurações → E-mail). Os provedores ficam neste
// computador, por usuário.
import { WHATSAPP_URL } from "./whatsapp";

/** Dígitos para o WhatsApp (com DDI); número brasileiro sem DDI ganha o 55. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (!phone.trim().startsWith("+") && (d.length === 10 || d.length === 11)) d = `55${d}`;
  return d.length >= 10 ? d : null;
}

export const whatsappSendUrl = (digits: string) => `${WHATSAPP_URL}/send?phone=${digits}`;

/** Abre a conversa no WhatsApp Web, reaproveitando a aba já aberta (o WhatsApp só aceita uma). */
export async function openWhatsApp(phone: string): Promise<void> {
  const digits = whatsappDigits(phone);
  if (!digits) return;
  const url = whatsappSendUrl(digits);
  const [tab] = await chrome.tabs.query({ url: `${WHATSAPP_URL}/*` });
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { url, active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

export type EmailProviderKind = "gmail" | "outlook" | "outlook_pessoal" | "yahoo" | "padrao" | "outro";

export interface EmailProvider {
  id: string;
  kind: EmailProviderKind;
  /** Nome mostrado na escolha (ex.: "Gmail", "Zoho da empresa"). */
  name: string;
  /** Só no "outro": link de abertura; {email} vira o destinatário. */
  url?: string;
}

export const EMAIL_KINDS: { kind: EmailProviderKind; label: string; hint: string }[] = [
  { kind: "gmail", label: "Gmail", hint: "Abre a janela de nova mensagem do Gmail." },
  { kind: "outlook", label: "Outlook (Microsoft 365)", hint: "Conta de trabalho ou escola (outlook.office.com)." },
  { kind: "outlook_pessoal", label: "Outlook.com / Hotmail", hint: "Conta pessoal (outlook.live.com)." },
  { kind: "yahoo", label: "Yahoo Mail", hint: "Abre a nova mensagem do Yahoo." },
  { kind: "padrao", label: "Aplicativo de e-mail do computador", hint: "Usa o programa padrão do sistema (link mailto:)." },
  { kind: "outro", label: "Outro (informar o link)", hint: "Ex.: https://mail.zoho.com/zm/#mail/folder/inbox" },
];

export const emailKindLabel = (k: EmailProviderKind) => EMAIL_KINDS.find((x) => x.kind === k)?.label ?? k;

/**
 * Link que abre o provedor para escrever ao destinatário. No "outro", {email}
 * no link vira o endereço; sem {email}, o link abre como está e `copy` avisa
 * que o endereço deve ir para a área de transferência.
 */
export function composeUrl(p: EmailProvider, email: string): { url: string; copy: boolean } {
  const to = encodeURIComponent(email);
  switch (p.kind) {
    case "gmail":
      return { url: `https://mail.google.com/mail/?view=cm&fs=1&to=${to}`, copy: false };
    case "outlook":
      return { url: `https://outlook.office.com/mail/deeplink/compose?to=${to}`, copy: false };
    case "outlook_pessoal":
      return { url: `https://outlook.live.com/mail/0/deeplink/compose?to=${to}`, copy: false };
    case "yahoo":
      return { url: `https://compose.mail.yahoo.com/?to=${to}`, copy: false };
    case "padrao":
      return { url: `mailto:${email}`, copy: false };
    case "outro": {
      const base = (p.url ?? "").trim();
      if (base.includes("{email}")) return { url: base.replaceAll("{email}", to), copy: false };
      return { url: base, copy: true };
    }
  }
}

/** Link "outro" válido: http(s) com endereço. */
export function validProviderUrl(url: string | undefined): boolean {
  try {
    const u = new URL((url ?? "").trim());
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

const storeKey = (userId: string) => `conectcrm-email-providers-${userId}`;

export async function loadEmailProviders(userId: string): Promise<EmailProvider[]> {
  const v = (await chrome.storage.local.get(storeKey(userId)))[storeKey(userId)] as unknown;
  return Array.isArray(v) ? (v as EmailProvider[]) : [];
}

export async function saveEmailProviders(userId: string, list: EmailProvider[]): Promise<void> {
  await chrome.storage.local.set({ [storeKey(userId)]: list });
}

/** Abre o provedor; devolve true quando o endereço foi copiado (link sem {email}). */
export async function openEmail(p: EmailProvider, email: string): Promise<boolean> {
  const { url, copy } = composeUrl(p, email);
  if (copy) await navigator.clipboard.writeText(email).catch(() => undefined);
  if (url.startsWith("mailto:")) window.location.href = url;
  else await chrome.tabs.create({ url });
  return copy;
}
