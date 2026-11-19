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
  /** Documentos do cartão (contrato assinado, convocação…): vão numa nota privada logo depois. */
  files: ChatwootFile[] = [],
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
    if (files.length) await sendPrivateFiles(s, conv.id, attachmentsNote(files.map((f) => f.filename)), files, fetchFn);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ChatwootError(`${msg} — a conversa ${conv.id} já foi criada (${link}); complete por lá e não reenvie.`, e instanceof ChatwootError ? e.status : undefined, link);
  }
  return { conversationId: conv.id, link, contactCreated };
}

// ---------- Situação e cancelamento dos tickets ----------

export type TicketStatus = "open" | "pending" | "snoozed" | "resolved" | "deleted" | "unknown";
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Aberta",
  pending: "Pendente",
  snoozed: "Adiada",
  resolved: "Resolvida",
  deleted: "Apagada",
  unknown: "Situação não consultada",
};

export interface TicketState {
  id: number;
  status: TicketStatus;
  /** Pode ser cancelado (ainda não resolvido nem apagado). */
  cancelable: boolean;
  assignee: string | null;
  link: string;
  error?: string;
}

export const conversationLink = (s: Pick<ChatwootSettings, "baseUrl" | "accountId">, id: number) => `${s.baseUrl.replace(/\/+$/, "")}/app/accounts/${s.accountId}/conversations/${id}`;

/** Situação real das conversas no Chatwoot (404 = apagada; falha = não consultada). */
export async function ticketStates(s: ChatwootSettings, ids: number[], fetchFn: Fetch = fetch): Promise<TicketState[]> {
  const api = client(s, fetchFn);
  return Promise.all(
    ids.map(async (id): Promise<TicketState> => {
      const link = conversationLink(s, id);
      try {
        const c = await api<{ status?: string; meta?: { assignee?: { name?: string } | null } }>("GET", `/conversations/${id}`);
        const status = (["open", "pending", "snoozed", "resolved"].includes(String(c.status)) ? c.status : "unknown") as TicketStatus;
        return { id, status, cancelable: status !== "resolved", assignee: c.meta?.assignee?.name ?? null, link };
      } catch (e) {
        if (e instanceof ChatwootError && e.status === 404) return { id, status: "deleted", cancelable: false, assignee: null, link };
        return { id, status: "unknown", cancelable: false, assignee: null, link, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

/**
 * Regra do aviso: há ticket em andamento? Sem consulta ao Chatwoot, vale o que
 * o CRM guardou (cancelado pelo cartão = encerrado).
 */
export function activeTickets<T extends { conversation_id: number; canceled_at: string | null }>(tickets: T[], states: TicketState[] | null): T[] {
  return tickets.filter((t) => {
    const st = states?.find((x) => x.id === t.conversation_id);
    if (st && st.status !== "unknown") return st.status !== "resolved" && st.status !== "deleted";
    return !t.canceled_at;
  });
}

/**
 * Cancela o ticket: grava a observação como nota privada, devolve a conversa ao
 * dono do token (ou a `reassignTo`) e resolve. Nada é apagado; resolver não envia
 * e-mail ao cliente (CSAT desligado na inbox).
 */
export async function cancelTicket(
  s: ChatwootSettings,
  conversationId: number,
  note: string,
  fetchFn: Fetch = fetch,
  reassignTo?: number | null,
): Promise<{ conversationId: number; link: string; assigneeId: number; user: string }> {
  const reason = note.trim();
  if (reason.length < 3) throw new ChatwootError("Informe a observação do cancelamento (pelo menos 3 letras).");
  if (!s.token.trim()) throw new ChatwootError("Configure o token do Chatwoot em Configurações → Integrações → Chatwoot.");
  const api = client(s, fetchFn);
  const link = conversationLink(s, conversationId);
  const conv = await api<{ status?: string }>("GET", `/conversations/${conversationId}`);
  if (conv.status === "resolved") throw new ChatwootError(`A conversa ${conversationId} já está resolvida no Chatwoot.`, undefined, link);
  let profile: { id?: number; name?: string };
  try {
    const r = await fetchFn(`${s.baseUrl.replace(/\/+$/, "")}/api/v1/profile`, { headers: { api_access_token: s.token } });
    if (!r.ok) throw new ChatwootError(`Chatwoot: GET /profile → HTTP ${r.status}`, r.status);
    profile = (await r.json()) as { id?: number; name?: string };
  } catch (e) {
    if (e instanceof ChatwootError) throw e;
    throw new ChatwootError(`Sem conexão com o Chatwoot (${e instanceof Error ? e.message : String(e)}).`);
  }
  const assigneeId = reassignTo ?? profile.id;
  if (!assigneeId) throw new ChatwootError("O Chatwoot não informou o usuário dono do token.");
  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const body = `**Ticket cancelado**\n\nObservação: ${reason}\nCancelado por: ${profile.name ?? "ConectCRM"} em ${when}`;
  const done: string[] = [];
  try {
    await api("POST", `/conversations/${conversationId}/messages`, { content: body, message_type: "outgoing", private: true });
    done.push("nota gravada");
    await api("POST", `/conversations/${conversationId}/assignments`, { assignee_id: assigneeId });
    done.push("devolvida ao seu usuário");
    await api("POST", `/conversations/${conversationId}/toggle_status`, { status: "resolved" });
    done.push("resolvida");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ChatwootError(`${msg} (já feito: ${done.join(", ") || "nada"}).`, e instanceof ChatwootError ? e.status : undefined, link);
  }
  return { conversationId, link, assigneeId, user: profile.name ?? "" };
}

// ---------- Anexos (documentos do cartão) ----------

/** Limite por arquivo (o Chatwoot aceita até 40 MB por anexo na configuração padrão). */
export const CHATWOOT_FILE_MAX = 40 * 1024 * 1024;

export interface ChatwootFile {
  blob: Blob;
  filename: string;
}

/**
 * Nota privada com arquivos (multipart: content, message_type, private,
 * attachments[]). Usada ao abrir o ticket e depois, em conversa em andamento.
 */
export async function sendPrivateFiles(
  s: ChatwootSettings,
  conversationId: number,
  content: string,
  files: ChatwootFile[],
  fetchFn: Fetch = fetch,
): Promise<void> {
  if (!files.length) return;
  return sendMessage(s, conversationId, content, files, true, fetchFn);
}

/**
 * Resposta ao cliente: mensagem pública na conversa da inbox de e-mail — o
 * Chatwoot envia por e-mail ao contato, pelo endereço da inbox. Com arquivos,
 * eles vão anexos no e-mail.
 */
export async function sendPublicReply(s: ChatwootSettings, conversationId: number, content: string, files: ChatwootFile[] = [], fetchFn: Fetch = fetch): Promise<void> {
  if (!content.trim()) throw new ChatwootError("Escreva a mensagem para o cliente.");
  if (!s.token.trim()) throw new ChatwootError("Configure o token do Chatwoot em Configurações → Integrações → Chatwoot.");
  if (!files.length) {
    await client(s, fetchFn)("POST", `/conversations/${conversationId}/messages`, { content, message_type: "outgoing", private: false });
    return;
  }
  return sendMessage(s, conversationId, content, files, false, fetchFn);
}

/** Mensagem com arquivos (multipart: content, message_type, private, attachments[]). */
async function sendMessage(s: ChatwootSettings, conversationId: number, content: string, files: ChatwootFile[], isPrivate: boolean, fetchFn: Fetch): Promise<void> {
  const big = files.find((f) => f.blob.size > CHATWOOT_FILE_MAX);
  if (big) throw new ChatwootError(`"${big.filename}" passa de 40 MB (limite de anexo do Chatwoot).`);
  const form = new FormData();
  form.append("content", content);
  form.append("message_type", "outgoing");
  form.append("private", isPrivate ? "true" : "false");
  for (const f of files) form.append("attachments[]", f.blob, f.filename);
  const path = `/conversations/${conversationId}/messages`;
  let res: Response;
  try {
    // Sem Content-Type: o navegador põe o multipart com o boundary.
    res = await fetchFn(`${s.baseUrl.replace(/\/+$/, "")}/api/v1/accounts/${s.accountId}${path}`, { method: "POST", headers: { api_access_token: s.token }, body: form });
  } catch (e) {
    throw new ChatwootError(`Sem conexão com o Chatwoot (${e instanceof Error ? e.message : String(e)}).`, undefined, conversationLink(s, conversationId));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ChatwootError(
      `Chatwoot: POST ${path} (anexos) → HTTP ${res.status}${res.status === 413 ? " (arquivo grande demais para o servidor)" : ""}${text ? `: ${text.slice(0, 300)}` : ""}`,
      res.status,
      conversationLink(s, conversationId),
    );
  }
}

/** Texto da nota que leva os anexos. */
export const attachmentsNote = (names: string[], extra?: string) =>
  [`**Documentos anexos** (${names.length})`, "", ...names.map((n) => `- ${n}`), ...(extra?.trim() ? ["", extra.trim()] : [])].join("\n");
