// Leitura da conversa aberta no WhatsApp Web (nome e telefone do contato),
// portada do content.js do wa-pipedrive. `readOpenChat` roda DENTRO da aba do
// WhatsApp via chrome.scripting.executeScript, por isso não usa nada de fora.
export interface OpenChat {
  open: boolean;
  name: string | null;
  phone: string | null;
}

export function readOpenChat(): OpenChat {
  const main = document.querySelector("#main");
  const header = document.querySelector("#main header");
  if (!main || !header) return { open: false, name: null, phone: null };

  // 1ª linha visível do cabeçalho = nome do contato (a 2ª é o "visto por último").
  let name: string | null = null;
  const lines = ((header as HTMLElement).innerText || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length) name = lines[0]!;
  else {
    for (const s of header.querySelectorAll("span[title]")) {
      const t = (s.getAttribute("title") || "").trim();
      if (t) {
        name = t;
        break;
      }
    }
  }

  // Telefone: data-id clássico com número; contato não salvo mostra o número no
  // cabeçalho; chats novos (@lid) só têm o número no painel "Dados do contato".
  let phone: string | null = null;
  for (const el of main.querySelectorAll("[data-id]")) {
    const m = (el.getAttribute("data-id") || "").match(/(\d{10,15})@(?:c\.us|s\.whatsapp\.net)/);
    if (m) {
      phone = `+${m[1]}`;
      break;
    }
  }
  if (!phone) {
    const t = ((header as HTMLElement).innerText || "").match(/\+\d[\d\s().-]{9,18}\d/);
    if (t) phone = t[0].replace(/[\s().-]/g, "");
  }
  if (!phone) {
    for (const s of document.querySelectorAll("span, div")) {
      if (main.contains(s) || s.children.length > 0) continue;
      const txt = (s.textContent || "").trim();
      if (txt.length < 8 || txt.length > 22) continue;
      if (/^\+\d[\d\s().-]{8,18}\d$/.test(txt)) {
        phone = txt.replace(/[\s().-]/g, "");
        break;
      }
    }
  }
  if (name && phone && name.replace(/\D/g, "") === phone.replace(/\D/g, "")) name = null; // contato sem nome salvo
  return { open: true, name, phone };
}

export const WHATSAPP_URL = "https://web.whatsapp.com";

/** Lê a conversa da aba ativa; null quando a aba não é o WhatsApp Web. */
export async function readActiveWhatsAppChat(): Promise<OpenChat | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith(WHATSAPP_URL)) return null;
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readOpenChat });
  return (res?.result as OpenChat | undefined) ?? { open: false, name: null, phone: null };
}
