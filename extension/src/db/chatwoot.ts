// Ticket de ativação Powercubus no Chatwoot (spec 24): os 13 dados da nota
// privada saem do cartão — responsável (contato principal), dados fiscais do
// pagador (ou da principal), nome da escola (principal), valor do cartão e cinco
// campos personalizados do cartão (Qtd de turmas, Plano, Fim da vigência,
// Usuário, E-mail financeiro), achados pela chave reservada.
import { formatCnpj } from "../lib/cnpj";
import { createActivity } from "./activities";
import { payerOrganizationId } from "./cardOrganizations";
import { createCustomField, getCustomValues, listCustomFields, type CustomFieldType } from "./customFields";
import { updatePerson } from "./contacts";
import { addNote } from "./notes";
import { insertRow, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";
import { ValidationError } from "../lib/validate";
import { CHATWOOT_FIELDS, CHATWOOT_FIELD_LABEL, chatwootMissing, chatwootNote, type ChatwootData, type ChatwootField } from "../lib/chatwootNote";
export { CHATWOOT_FIELDS, CHATWOOT_FIELD_LABEL, chatwootMissing, chatwootNote, type ChatwootData, type ChatwootField };

/** Campos personalizados do cartão usados aqui (chave reservada → definição). */
export const CHATWOOT_CARD_FIELDS: { key: string; field: ChatwootField; name: string; type: CustomFieldType; description: string }[] = [
  { key: "qtd_turmas", field: "qtd_turmas", name: "Qtd de turmas", type: "number", description: "Quantidade de turmas contratadas (ativação Powercubus no Chatwoot)." },
  { key: "plano", field: "plano", name: "Plano", type: "text", description: "Plano contratado (ativação Powercubus no Chatwoot)." },
  { key: "vencimento_boleto", field: "vencimento_boleto", name: "Vencimento do boleto", type: "date", description: "Data de vencimento do boleto; vazio = vencimento da última cobrança do cartão (ativação Powercubus no Chatwoot)." },
  { key: "fim_vigencia", field: "fim_vigencia", name: "Fim da vigência", type: "date", description: "Fim da vigência do contrato (ativação Powercubus no Chatwoot)." },
  { key: "usuario_powercubus", field: "usuario", name: "Usuário Powercubus", type: "text", description: "Usuário de acesso; vazio = e-mail do responsável." },
  { key: "email_usuario_powercubus", field: "email_usuario", name: "E-mail do usuário PowerCubus", type: "email", description: "E-mail do usuário de acesso; vazio = e-mail do responsável." },
  { key: "email_financeiro", field: "email_financeiro", name: "E-mail financeiro", type: "email", description: "E-mail para envio de boletos e Nota Fiscal." },
];

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
const dmy = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : iso);
const cepFmt = (c: string | null) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (c ?? "");
};

/** Campos personalizados do cartão já criados (por chave). */
export function chatwootCardFields(db: DatabaseSync): Partial<Record<ChatwootField, { id: string; type: CustomFieldType; pipelineIds: string[] }>> {
  const all = listCustomFields(db, "deal");
  const out: Partial<Record<ChatwootField, { id: string; type: CustomFieldType; pipelineIds: string[] }>> = {};
  for (const d of CHATWOOT_CARD_FIELDS) {
    const f = all.find((x) => x.placeholder_key === d.key);
    if (f) out[d.field] = { id: f.id, type: f.field_type, pipelineIds: f.pipelineIds };
  }
  return out;
}

/** Cria os campos que faltam, só nos funis indicados (vazio = todos os funis comerciais). */
export function ensureChatwootFields(db: DatabaseSync, ctx: DbContext, pipelineIds: string[]): { created: string[] } {
  return withTransaction(db, () => {
    const have = chatwootCardFields(db);
    const created: string[] = [];
    for (const d of CHATWOOT_CARD_FIELDS) {
      if (have[d.field]) continue;
      createCustomField(db, ctx, { entity: "deal", name: d.name, description: d.description, fieldType: d.type, placeholderKey: d.key, pipelineIds });
      created.push(d.name);
    }
    return { created };
  });
}

export interface ChatwootTicket {
  id: string;
  conversation_id: number;
  link: string;
  contact_email: string | null;
  created_at: string;
  created_by_name: string | null;
  /** Cancelado pelo cartão (resolvido no Chatwoot com observação). */
  canceled_at: string | null;
  cancel_note: string | null;
}

export function listChatwootTickets(db: DatabaseSync, cardId: string): ChatwootTicket[] {
  return many<ChatwootTicket>(
    db,
    `SELECT t.id, t.conversation_id, t.link, t.contact_email, t.created_at, u.name AS created_by_name, t.canceled_at, t.cancel_note
     FROM chatwoot_ticket t LEFT JOIN app_user u ON u.id = t.created_by
     WHERE t.card_id = ? AND t.deleted_at IS NULL ORDER BY t.created_at DESC`,
    cardId,
  );
}

export interface ChatwootContext {
  cardTitle: string;
  pipelineId: string;
  data: ChatwootData;
  /** De onde veio cada dado (para a tela explicar). */
  source: Record<ChatwootField, string>;
  fields: Partial<Record<ChatwootField, { id: string; type: CustomFieldType }>>;
  /** Campos personalizados que faltam criar (nomes). */
  missingFields: string[];
  tickets: ChatwootTicket[];
}

function address(o: { street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null }): string {
  const first = [o.street, o.number].filter(Boolean).join(", ");
  const city = [o.city, o.state].filter(Boolean).join("/");
  return [first, o.complement, o.district, city].filter((x) => x && String(x).trim()).join(" - ");
}

/** Dados do cartão para a nota do Chatwoot (a tela deixa revisar antes de enviar). */
export function chatwootContext(db: DatabaseSync, cardId: string): ChatwootContext {
  const card = one<{ title: string; pipeline_id: string; value_cents: number; person_id: string | null; organization_id: string | null }>(
    db,
    "SELECT title, pipeline_id, value_cents, person_id, organization_id FROM deal WHERE id = ? AND deleted_at IS NULL",
    cardId,
  );
  if (!card) throw new ValidationError("Cartão não encontrado.");
  const person = card.person_id ? one<{ name: string; email: string | null }>(db, "SELECT name, email FROM person WHERE id = ? AND deleted_at IS NULL", card.person_id) : undefined;
  type Org = { name: string; legal_name: string | null; cnpj: string | null; cep: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null };
  const org = (id: string | null) =>
    id
      ? one<Org>(db, "SELECT name, legal_name, cnpj, cep, street, number, complement, district, city, state FROM organization WHERE id = ? AND deleted_at IS NULL", id)
      : undefined;
  const school = org(card.organization_id);
  const payerId = payerOrganizationId(db, cardId);
  const payer = org(payerId);
  const payerIsSchool = payerId === card.organization_id;
  const fields = chatwootCardFields(db);
  const values = getCustomValues(db, cardId);
  const fv = (f: ChatwootField): string => {
    const def = fields[f];
    const v = def ? values[def.id] : undefined;
    if (v === undefined || v === null || v === "") return "";
    return def!.type === "date" ? dmy(String(v)) : String(v);
  };
  const fiscal = payerIsSchool ? "organização principal" : "organização pagadora";
  // Sem o campo preenchido: o vencimento da cobrança mais recente (não cancelada) do cartão.
  const lastChargeDue =
    one<{ d: string | null }>(db, "SELECT due_date AS d FROM payment_charge WHERE card_id = ? AND deleted_at IS NULL AND status <> 'canceled' AND due_date IS NOT NULL ORDER BY created_at DESC LIMIT 1", cardId)?.d ?? null;
  const data: ChatwootData = {
    email_cliente: person?.email ?? "",
    nome_responsavel: person?.name ?? "",
    usuario: fv("usuario") || person?.email || "",
    email_usuario: fv("email_usuario") || person?.email || "",
    qtd_turmas: fv("qtd_turmas"),
    plano: fv("plano"),
    vencimento_boleto: fv("vencimento_boleto") || (lastChargeDue ? dmy(lastChargeDue) : ""),
    fim_vigencia: fv("fim_vigencia"),
    valor: card.value_cents ? brl(card.value_cents) : "",
    razao_social: payer ? payer.legal_name || payer.name : "",
    nome_escola: school?.name ?? "",
    cnpj: payer?.cnpj ? formatCnpj(payer.cnpj) : "",
    cep: payer ? cepFmt(payer.cep) : "",
    endereco: payer ? address(payer) : "",
    email_financeiro: fv("email_financeiro"),
  };
  const field = (f: ChatwootField, name: string) => (fields[f] ? `campo "${name}" do cartão` : `campo "${name}" (ainda não criado)`);
  const source: Record<ChatwootField, string> = {
    email_cliente: "contato principal",
    nome_responsavel: "contato principal",
    usuario: fv("usuario") ? field("usuario", "Usuário Powercubus") : "e-mail do contato principal",
    email_usuario: fv("email_usuario") ? field("email_usuario", "E-mail do usuário PowerCubus") : "e-mail do contato principal",
    qtd_turmas: field("qtd_turmas", "Qtd de turmas"),
    plano: field("plano", "Plano"),
    vencimento_boleto: fv("vencimento_boleto")
      ? field("vencimento_boleto", "Vencimento do boleto")
      : lastChargeDue
        ? "vencimento da última cobrança do cartão"
        : field("vencimento_boleto", "Vencimento do boleto"),
    fim_vigencia: field("fim_vigencia", "Fim da vigência"),
    valor: "valor do cartão",
    razao_social: fiscal,
    nome_escola: "organização principal",
    cnpj: fiscal,
    cep: fiscal,
    endereco: fiscal,
    email_financeiro: field("email_financeiro", "E-mail financeiro"),
  };
  return {
    cardTitle: card.title,
    pipelineId: card.pipeline_id,
    data,
    source,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { id: v!.id, type: v!.type }])) as ChatwootContext["fields"],
    missingFields: CHATWOOT_CARD_FIELDS.filter((d) => !fields[d.field]).map((d) => d.name),
    tickets: listChatwootTickets(db, cardId),
  };
}

/** Ticket aberto: guarda, deixa nota no cartão e cria a atividade de acompanhamento (2 dias). */
export function recordChatwootTicket(
  db: DatabaseSync,
  ctx: DbContext,
  cardId: string,
  input: {
    conversationId: number;
    link: string;
    data: ChatwootData;
    contactCreated?: boolean;
    attachments?: string[];
    memo?: string;
    /** Grava o "E-mail do cliente" no contato principal do cartão, se ele ainda não tiver e-mail. */
    saveContactEmail?: boolean;
  },
  now = new Date(),
): { ticketId: string; activityId: string; paymentActivityId: string | null; contactEmailSaved: boolean } {
  if (!Number.isInteger(input.conversationId) || input.conversationId <= 0) throw new ValidationError("Conversa do Chatwoot inválida.");
  if (!/^https:\/\//.test(input.link)) throw new ValidationError("Link da conversa inválido.");
  return withTransaction(db, () => {
    const deal = one<{ person_id: string | null }>(db, "SELECT person_id FROM deal WHERE id = ? AND deleted_at IS NULL", cardId);
    if (!deal) throw new ValidationError("Cartão não encontrado.");
    // E-mail informado para o ticket vai para o contato principal que não tinha
    // (não troca um e-mail que o contato já tem).
    let contactEmailSaved = false;
    const email = input.data.email_cliente.trim();
    if (input.saveContactEmail && deal.person_id && email) {
      const current = one<{ email: string | null }>(db, "SELECT email FROM person WHERE id = ? AND deleted_at IS NULL", deal.person_id);
      if (current && !current.email?.trim()) {
        try {
          updatePerson(db, ctx, deal.person_id, { email });
          contactEmailSaved = true;
        } catch {
          /* e-mail recusado pelo cadastro: o ticket segue registrado */
        }
      }
    }
    const ticketId = insertRow(db, ctx, "chatwoot_ticket", {
      card_id: cardId,
      conversation_id: input.conversationId,
      link: input.link,
      contact_email: input.data.email_cliente || null,
    });
    addNote(
      db,
      ctx,
      "deal",
      cardId,
      [
        `Ticket de ativação aberto no Chatwoot (conversa ${input.conversationId}${input.contactCreated ? ", contato criado lá" : ""}):`,
        input.link,
        "",
        chatwootNote(input.data, input.memo ?? "").replace(/\*\*/g, ""),
        ...(input.attachments?.length ? ["", `Anexos enviados: ${input.attachments.join(", ")}`] : []),
      ].join("\n"),
    );
    const due = new Date(now.getTime() + 2 * 86400_000);
    due.setHours(9, 0, 0, 0);
    const activityId = createActivity(db, ctx, {
      title: "Acompanhar ativação no Chatwoot",
      description: `Conversa ${input.conversationId}: ${input.link}`,
      dueAt: due.toISOString(),
      dealId: cardId,
      ownerId: ctx.userId,
    });
    // Vencimento do boleto informado: conferir o pagamento no dia seguinte (9h).
    const venc = parseBrDate(input.data.vencimento_boleto);
    let paymentActivityId: string | null = null;
    if (venc) {
      const check = new Date(venc.y, venc.m - 1, venc.d + 1, 9, 0, 0, 0);
      paymentActivityId = createActivity(db, ctx, {
        title: PAYMENT_CHECK_TITLE,
        description: [
          `Boleto com vencimento em ${input.data.vencimento_boleto}${input.data.valor ? ` (${input.data.valor})` : ""}: confirme se o cliente pagou.`,
          `Escola: ${input.data.nome_escola || "-"} · Pagador: ${input.data.razao_social || "-"}`,
          `Ticket da ativação no Chatwoot: ${input.link}`,
        ].join("\n"),
        dueAt: check.toISOString(),
        dealId: cardId,
        ownerId: ctx.userId,
      });
    }
    return { ticketId, activityId, paymentActivityId, contactEmailSaved };
  });
}

/** "20/11/2026" → { y, m, d } (null se não for uma data válida). */
export function parseBrDate(v: string | null | undefined): { y: number; m: number; d: number } | null {
  const m = (v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? { y, m: mo, d } : null;
}

/** Ticket cancelado pela janela do cartão: guarda a observação e deixa nota no cartão. */
export function recordChatwootCancel(db: DatabaseSync, ctx: DbContext, cardId: string, input: { conversationId: number; note: string; by?: string | null }): void {
  const note = input.note.trim();
  if (note.length < 3) throw new ValidationError("Informe a observação do cancelamento.");
  withTransaction(db, () => {
    const t = one<{ id: string; link: string }>(
      db,
      "SELECT id, link FROM chatwoot_ticket WHERE card_id = ? AND conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
      cardId,
      input.conversationId,
    );
    if (!t) throw new ValidationError("Este ticket não está registrado neste cartão.");
    updateRow(db, ctx, "chatwoot_ticket", t.id, { canceled_at: new Date().toISOString(), cancel_note: note });
    addNote(
      db,
      ctx,
      "deal",
      cardId,
      [`Ticket do Chatwoot cancelado (conversa ${input.conversationId}, resolvida${input.by ? ` e devolvida a ${input.by}` : ""}):`, t.link, "", `Observação: ${note}`].join("\n"),
    );
  });
}

/** Documentos enviados depois a uma conversa já aberta: nota no cartão. */
export function recordChatwootAttachments(db: DatabaseSync, ctx: DbContext, cardId: string, input: { conversationId: number; names: string[] }): void {
  if (!input.names.length) return;
  const t = one<{ link: string }>(
    db,
    "SELECT link FROM chatwoot_ticket WHERE card_id = ? AND conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    cardId,
    input.conversationId,
  );
  if (!t) throw new ValidationError("Este ticket não está registrado neste cartão.");
  addNote(db, ctx, "deal", cardId, [`Documentos enviados ao Chatwoot (conversa ${input.conversationId}):`, t.link, "", ...input.names.map((n) => `- ${n}`)].join("\n"));
}

/** E-mail enviado ao cliente pelo Chatwoot: nota no cartão com o texto e os anexos. */
export function recordChatwootReply(db: DatabaseSync, ctx: DbContext, cardId: string, input: { conversationId: number; text: string; to?: string | null; names?: string[] }): void {
  const t = one<{ link: string }>(
    db,
    "SELECT link FROM chatwoot_ticket WHERE card_id = ? AND conversation_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    cardId,
    input.conversationId,
  );
  if (!t) throw new ValidationError("Este ticket não está registrado neste cartão.");
  addNote(
    db,
    ctx,
    "deal",
    cardId,
    [
      `E-mail enviado ao cliente pelo Chatwoot${input.to ? ` (para ${input.to})` : ""}, conversa ${input.conversationId}:`,
      t.link,
      "",
      input.text.trim(),
      ...(input.names?.length ? ["", `Anexos: ${input.names.join(", ")}`] : []),
    ].join("\n"),
  );
}

export const PAYMENT_CHECK_TITLE = "Conferir pagamento do boleto";

export interface PaymentCheckPlan {
  cardId: string;
  cardTitle: string;
  conversationId: number;
  /** "dd/mm/aaaa" ou "" */
  dueBoleto: string;
  /** Data da atividade (aaaa-mm-dd) ou null quando não dá para criar. */
  checkDate: string | null;
  status: "criar" | "ja_existe" | "sem_vencimento" | "pago";
}

/**
 * Rotina para tickets já abertos: em cada cartão com ticket de ativação não
 * cancelado, cria "Conferir pagamento do boleto" um dia após o vencimento
 * (campo do cartão ou última cobrança). Não repete se já existe a atividade
 * no cartão; pula cobrança já paga. `dryRun` só mostra o plano.
 */
export function backfillPaymentChecks(db: DatabaseSync, ctx: DbContext, opts: { dryRun?: boolean } = {}): PaymentCheckPlan[] {
  const rows = many<{ card_id: string; conversation_id: number; link: string; created_by: string | null }>(
    db,
    `SELECT t.card_id, t.conversation_id, t.link, t.created_by FROM chatwoot_ticket t
     JOIN deal d ON d.id = t.card_id AND d.deleted_at IS NULL
     WHERE t.deleted_at IS NULL AND t.canceled_at IS NULL
       AND t.created_at = (SELECT MAX(x.created_at) FROM chatwoot_ticket x WHERE x.card_id = t.card_id AND x.deleted_at IS NULL AND x.canceled_at IS NULL)
     ORDER BY t.created_at`,
  );
  const plans: PaymentCheckPlan[] = [];
  const run = () => {
    for (const r of rows) {
      const c = chatwootContext(db, r.card_id);
      // Vencimento: o enviado na nota do ticket (cartão); senão, o campo do cartão / a última cobrança.
      const fromNote = ticketNoteDue(db, r.card_id, r.conversation_id);
      if (fromNote) c.data.vencimento_boleto = fromNote;
      const venc = parseBrDate(c.data.vencimento_boleto);
      const base = { cardId: r.card_id, cardTitle: c.cardTitle, conversationId: r.conversation_id, dueBoleto: c.data.vencimento_boleto };
      if (one(db, "SELECT 1 FROM activity WHERE deal_id = ? AND title = ? AND deleted_at IS NULL", r.card_id, PAYMENT_CHECK_TITLE)) {
        plans.push({ ...base, checkDate: null, status: "ja_existe" });
        continue;
      }
      const last = one<{ status: string }>(
        db,
        "SELECT status FROM payment_charge WHERE card_id = ? AND deleted_at IS NULL AND status <> 'canceled' ORDER BY created_at DESC LIMIT 1",
        r.card_id,
      );
      if (last?.status === "paid") {
        plans.push({ ...base, checkDate: null, status: "pago" });
        continue;
      }
      if (!venc) {
        plans.push({ ...base, checkDate: null, status: "sem_vencimento" });
        continue;
      }
      const check = new Date(venc.y, venc.m - 1, venc.d + 1, 9, 0, 0, 0);
      const checkDate = `${check.getFullYear()}-${String(check.getMonth() + 1).padStart(2, "0")}-${String(check.getDate()).padStart(2, "0")}`;
      plans.push({ ...base, checkDate, status: "criar" });
      if (opts.dryRun) continue;
      const owner = r.created_by && one(db, "SELECT 1 FROM app_user WHERE id = ? AND deleted_at IS NULL", r.created_by) ? r.created_by : ctx.userId;
      createActivity(db, ctx, {
        title: PAYMENT_CHECK_TITLE,
        description: [
          `Boleto com vencimento em ${c.data.vencimento_boleto}${c.data.valor ? ` (${c.data.valor})` : ""}: confirme se o cliente pagou.`,
          `Escola: ${c.data.nome_escola || "-"} · Pagador: ${c.data.razao_social || "-"}`,
          `Ticket da ativação no Chatwoot: ${r.link}`,
        ].join("\n"),
        dueAt: check.toISOString(),
        dealId: r.card_id,
        ownerId: owner,
      });
    }
  };
  if (opts.dryRun) run();
  else withTransaction(db, run);
  return plans;
}

/** "Data de Vencimento do Boleto" gravada na nota do cartão quando o ticket foi aberto. */
function ticketNoteDue(db: DatabaseSync, cardId: string, conversationId: number): string | null {
  const n = one<{ body: string }>(
    db,
    `SELECT body FROM note WHERE entity_type = 'deal' AND entity_id = ? AND deleted_at IS NULL
       AND body LIKE ? AND body LIKE '%Data de Vencimento do Boleto:%' ORDER BY created_at DESC LIMIT 1`,
    cardId,
    `Ticket de ativação aberto no Chatwoot (conversa ${conversationId}%`,
  );
  const m = n?.body.match(/Data de Vencimento do Boleto:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  return m ? m[1]! : null;
}
