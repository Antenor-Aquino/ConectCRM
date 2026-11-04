// Leitura da conversa aberta no WhatsApp Web (nome e telefone do contato),
// portada do content.js do wa-pipedrive. `readOpenChat` roda DENTRO da aba do
// WhatsApp via chrome.scripting.executeScript, por isso não usa nada de fora.
/** De onde o número foi lido (do mais confiável para o menos). */
export type PhoneSource = "painel" | "cabecalho" | "conversa";
export const PHONE_SOURCE_LABEL: Record<PhoneSource, string> = {
  painel: "Dados do contato",
  cabecalho: "cabeçalho da conversa",
  conversa: "código das mensagens",
};

export interface OpenChat {
  open: boolean;
  name: string | null;
  /** O número mais confiável encontrado (ver `candidates`). */
  phone: string | null;
  /** Todos os números diferentes encontrados, do mais confiável para o menos. */
  candidates?: { phone: string; source: PhoneSource }[];
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

  const clean = (t: string) => `+${t.replace(/\D/g, "")}`;
  const isPhone = (t: string) => t.length >= 8 && t.length <= 22 && /^\+\d[\d\s().-]{8,18}\d$/.test(t);
  const found: { phone: string; source: PhoneSource }[] = [];
  const add = (phone: string, source: PhoneSource) => {
    if (!found.some((f) => f.phone === phone)) found.push({ phone, source });
  };
  const sidebar = document.querySelector("#pane-side");
  const outside = (el: Element) => !main.contains(el) && !(sidebar && sidebar.contains(el));

  // 1) Painel "Dados do contato" (aberto à direita): o número atual do contato.
  //    Procura a partir do título do painel; nunca na lista de conversas (#pane-side),
  //    que mostra números de outros contatos.
  const TITLES = ["Dados do contato", "Informações do contato", "Contact info", "Dados da empresa", "Business info", "Info. do contato"];
  for (const t of document.querySelectorAll("span, div, h1, h2")) {
    if (!outside(t) || !TITLES.includes((t.textContent || "").trim())) continue;
    let box: Element | null = t;
    for (let i = 0; i < 10 && box && !found.some((f) => f.source === "painel"); i++) {
      box = box.parentElement;
      if (!box || box.contains(main)) break;
      for (const s of box.querySelectorAll("span, div")) {
        if (s.children.length > 0) continue;
        const txt = (s.textContent || "").trim();
        if (isPhone(txt)) {
          add(clean(txt), "painel");
          break;
        }
      }
    }
  }

  // 2) Cabeçalho: contato sem nome salvo mostra o número.
  const head = ((header as HTMLElement).innerText || "").match(/\+\d[\d\s().-]{9,18}\d/);
  if (head) add(clean(head[0]), "cabecalho");

  // 3) Código das mensagens ("true_5511…@c.us_ID"): só a PARTE DA CONVERSA (o
  //    início), nunca o remetente/citação do fim. Vale a mensagem mais recente:
  //    em conversa antiga, o contato pode ter trocado de número.
  let fromMessages: string | null = null;
  for (const el of main.querySelectorAll("[data-id]")) {
    const m = (el.getAttribute("data-id") || "").match(/^(?:true|false)_(\d{10,15})@(?:c\.us|s\.whatsapp\.net)_/);
    if (m) fromMessages = `+${m[1]}`;
  }
  if (fromMessages) add(fromMessages, "conversa");

  // 4) Sem nada acima: algum número solto fora da conversa e da lista (painel com título diferente).
  if (!found.length) {
    for (const s of document.querySelectorAll("span, div")) {
      if (!outside(s) || s.children.length > 0) continue;
      const txt = (s.textContent || "").trim();
      if (isPhone(txt)) {
        add(clean(txt), "painel");
        break;
      }
    }
  }

  const phone = found[0]?.phone ?? null;
  if (name && phone && name.replace(/\D/g, "") === phone.replace(/\D/g, "")) name = null; // contato sem nome salvo
  return { open: true, name, phone, candidates: found };
}

export const WHATSAPP_URL = "https://web.whatsapp.com";

/** Lê a conversa da aba ativa; null quando a aba não é o WhatsApp Web. */
export async function readActiveWhatsAppChat(): Promise<OpenChat | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith(WHATSAPP_URL)) return null;
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readOpenChat });
  return (res?.result as OpenChat | undefined) ?? { open: false, name: null, phone: null };
}
