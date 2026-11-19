// Ticket de ativação Powercubus no Chatwoot (spec 24): os 13 dados da nota
// privada saem do cartão — responsável (contato principal), dados fiscais do
// pagador (ou da principal), nome da escola (principal), valor do cartão e cinco
// campos personalizados do cartão (Qtd de turmas, Plano, Fim da vigência,
// Usuário, E-mail financeiro), achados pela chave reservada.
import { formatCnpj } from "../lib/cnpj";
import { createActivity } from "./activities";
import { payerOrganizationId } from "./cardOrganizations";
import { createCustomField, getCustomValues, listCustomFields, type CustomFieldType } from "./customFields";
import { addNote } from "./notes";
import { insertRow, type DbContext } from "./repo";
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
}

export function listChatwootTickets(db: DatabaseSync, cardId: string): ChatwootTicket[] {
  return many<ChatwootTicket>(
    db,
    `SELECT t.id, t.conversation_id, t.link, t.contact_email, t.created_at, u.name AS created_by_name
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
  input: { conversationId: number; link: string; data: ChatwootData; contactCreated?: boolean },
  now = new Date(),
): { ticketId: string; activityId: string } {
  if (!Number.isInteger(input.conversationId) || input.conversationId <= 0) throw new ValidationError("Conversa do Chatwoot inválida.");
  if (!/^https:\/\//.test(input.link)) throw new ValidationError("Link da conversa inválido.");
  return withTransaction(db, () => {
    if (!one(db, "SELECT 1 FROM deal WHERE id = ? AND deleted_at IS NULL", cardId)) throw new ValidationError("Cartão não encontrado.");
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
        chatwootNote(input.data).replace(/\*\*/g, ""),
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
    return { ticketId, activityId };
  });
}
