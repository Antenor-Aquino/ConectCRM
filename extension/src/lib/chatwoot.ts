// Cliente da API do Chatwoot para o ticket de ativação Powercubus (spec 24).
// Porte do módulo chatwoot-ativacao.js: busca/cria o contato pelo e-mail, abre
// a conversa na inbox de e-mail sem mensagem inicial (não dispara e-mail),
// grava a nota privada e a etiqueta e devolve o link. O token fica só neste
// computador (chrome.storage.local), nunca no banco do CRM nem no backup.
import { chatwootNote, chatwootMissing, CHATWOOT_FIELD_LABEL, type ChatwootData } from "./chatwootNote";

export interface ChatwootSettings {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  assigneeId: number | null;
  label: string;
  subjectBase: string;
  /** Token de acesso (Perfil → Access Token no Chatwoot). */
  token: string;
  /** Funis em que o botão aparece no cartão (vazio = todos). */
  pipelineIds: string[];
}

export const CHATWOOT_DEFAULTS: ChatwootSettings = {
  baseUrl: "https://suporte.powercubus.com.br",
  accountId: 1,
  inboxId: 16,
  assigneeId: 6,
  label: "conta-mg-ativacao",
  subjectBase: "Ativação de conta Powercubus",
  token: "",
  pipelineIds: [],
};

const KEY = "conectcrm-chatwoot";

export async function loadChatwoot(): Promise<ChatwootSettings> {
  const v = (await chrome.storage.local.get(KEY))[KEY] as Partial<ChatwootSettings> | undefined;
  return { ...CHATWOOT_DEFAULTS, ...(v ?? {}) };
}
export async function saveChatwoot(s: ChatwootSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: { ...s, baseUrl: s.baseUrl.trim().replace(/\/+$/, ""), token: s.token.trim(), label: s.label.trim() } });
}

export const chatwootReady = (s: ChatwootSettings | null) => !!s?.token.trim() && !!s.baseUrl && s.accountId > 0 && s.inboxId > 0;
export const chatwootOrigin = (s: Pick<ChatwootSettings, "baseUrl">) => `${new URL(s.baseUrl).origin}/*`;

/** Permissão do site do Chatwoot (1º uso). Precisa ser a 1ª chamada dentro do clique. */
export function requestChatwootPermission(s: Pick<ChatwootSettings, "baseUrl">): Promise<boolean> {
  if (!chrome.permissions?.request) return Promise.resolve(true);
  return chrome.permissions.request({ origins: [chatwootOrigin(s)] });
}

export class ChatwootError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Conversa já criada antes da falha (não reenviar sem conferir). */
    readonly link?: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

function client(s: ChatwootSettings, fetchFn: Fetch) {
  const base = `${s.baseUrl.replace(/\/+$/, "")}/api/v1/accounts/${s.accountId}`;
  return async function api<T>(method: string, path: string, payload?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(base + path, {
        method,
        headers: { api_access_token: s.token, "Content-Type": "application/json" },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      });
    } catch (e) {
      throw new ChatwootError(`Sem conexão com o Chatwoot (${e instanceof Error ? e.message : String(e)}).`);
    }
    const text = await res.text();
    if (!res.ok) {
      const hint =
        res.status === 401
          ? "token inválido ou revogado: gere um novo em Perfil → Access Token e salve em Configurações → Integrações → Chatwoot"
          : res.status === 404
            ? "conta, inbox ou rota não encontrada: confira os números da conta e da inbox"
            : res.status === 422
              ? "o Chatwoot recusou os dados (confira inbox, agente e e-mail do contato)"
              : "";
      throw new ChatwootError(`Chatwoot: ${method} ${path} → HTTP ${res.status}${hint ? ` (${hint})` : ""}${text ? `: ${text.slice(0, 300)}` : ""}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  };
}

/** Conferência das configurações: lê o perfil do dono do token e a inbox. */
export async function testChatwoot(s: ChatwootSettings, fetchFn: Fetch = fetch): Promise<{ user: string; inbox: string }> {
  const api = client(s, fetchFn);
  const base = `${s.baseUrl.replace(/\/+$/, "")}/api/v1`;
  let user = "";
  try {
    const r = await fetchFn(`${base}/profile`, { headers: { api_access_token: s.token } });
    if (r.status === 401) throw new ChatwootError("Chatwoot: token inválido ou revogado.", 401);
    user = ((await r.json()) as { name?: string }).name ?? "";
  } catch (e) {
    if (e instanceof ChatwootError) throw e;
  }
  const inboxes = await api<{ payload?: { id: number; name: string }[] }>("GET", "/inboxes");
  const inbox = inboxes.payload?.find((i) => i.id === s.inboxId);
  if (!inbox) throw new ChatwootError(`A inbox ${s.inboxId} não existe nesta conta do Chatwoot.`);
  return { user, inbox: inbox.name };
}

/** Abre o ticket de ativação (contato → conversa → nota privada → etiqueta). */
export async function openActivationTicket(
  s: ChatwootSettings,
  dados: ChatwootData,
  fetchFn: Fetch = fetch,
): Promise<{ conversationId: number; link: string; contactCreated: boolean }> {
  if (!s.token.trim()) throw new ChatwootError("Configure o token do Chatwoot em Configurações → Integrações → Chatwoot.");
  const missing = chatwootMissing(dados);
  if (missing.length) throw new ChatwootError(`Preencha: ${missing.map((k) => CHATWOOT_FIELD_LABEL[k]).join(", ")}.`);
  const api = client(s, fetchFn);
  const email = dados.email_cliente.trim();
  type Contact = { id: number; email?: string | null };
  const find = async () =>
    ((await api<{ payload?: Contact[] }>("GET", `/contacts/search?q=${encodeURIComponent(email)}`)).payload ?? []).find(
      (c) => (c.email ?? "").toLowerCase() === email.toLowerCase(),
    ) ?? null;
  let contact = await find();
  let contactCreated = false;
  if (!contact) {
    try {
      const r = await api<{ payload?: { contact?: Contact } }>("POST", "/contacts", { inbox_id: s.inboxId, name: dados.nome_responsavel, email });
      contact = r.payload?.contact ?? null;
      contactCreated = !!contact;
    } catch (e) {
      contact = await find(); // criado ao mesmo tempo por outra chamada
      if (!contact) throw e;
    }
    if (!contact) throw new ChatwootError("O Chatwoot não devolveu o contato criado.");
  }
  // Sem "message" de propósito: não dispara e-mail ao cliente na abertura.
  const conv = await api<{ id: number }>("POST", "/conversations", {
    inbox_id: s.inboxId,
    contact_id: contact.id,
    source_id: email,
    status: "open",
    ...(s.assigneeId ? { assignee_id: s.assigneeId } : {}),
    additional_attributes: { mail_subject: `${s.subjectBase} - ${dados.nome_escola}` },
  });
  const link = `${s.baseUrl.replace(/\/+$/, "")}/app/accounts/${s.accountId}/conversations/${conv.id}`;
  try {
    await api("POST", `/conversations/${conv.id}/messages`, { content: chatwootNote(dados), message_type: "outgoing", private: true });
    if (s.label.trim()) await api("POST", `/conversations/${conv.id}/labels`, { labels: [s.label.trim()] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ChatwootError(`${msg} — a conversa ${conv.id} já foi criada (${link}); complete por lá e não reenvie.`, e instanceof ChatwootError ? e.status : undefined, link);
  }
  return { conversationId: conv.id, link, contactCreated };
}
