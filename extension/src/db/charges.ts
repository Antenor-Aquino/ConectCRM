// Cobrança do cartão (spec 21): link de pagamento do checkout da InfinitePay
// ou boleto + Pix do Banco Inter (spec 22).
// O CRM monta os itens a partir dos produtos e serviços do cartão, a extensão
// cria o link na InfinitePay e grava a cobrança aqui (com nota no cartão). A
// receita correspondente é lançada na Gestão Financeira pela aba Financeiro.
import { contextLinks, createDocument, type FileRef } from "./documents";
import { insertRow, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";
import { optionalText, requireText, ValidationError } from "../lib/validate";

export interface ChargeItem {
  description: string;
  quantity: number;
  /** Preço unitário em centavos (a InfinitePay usa centavos). */
  priceCents: number;
}

export interface ChargeCustomer {
  name: string | null;
  email: string | null;
  /** "+5587999999999" (formato da InfinitePay) ou null. */
  phone: string | null;
}

export type ChargeProvider = "infinitepay" | "inter";
export const PROVIDER_LABEL: Record<ChargeProvider, string> = { infinitepay: "InfinitePay", inter: "Banco Inter" };

export interface Charge {
  id: string;
  card_id: string;
  provider: ChargeProvider;
  handle: string;
  order_nsu: string;
  url: string;
  amount_cents: number;
  description: string;
  items: ChargeItem[];
  due_date: string | null;
  status: "open" | "paid" | "canceled";
  paid_at: string | null;
  created_at: string;
  /** Inter: código da solicitação, ambiente, situação, linha digitável, Pix copia e cola, PDF no GED. */
  provider_ref: string | null;
  provider_env: string | null;
  provider_status: string | null;
  barcode: string | null;
  pix_code: string | null;
  pdf_doc_id: string | null;
  received_cents: number | null;
  checked_at: string | null;
}

/** Pagador do boleto (Inter exige documento e endereço completo). */
export interface ChargePayer {
  kind: "FISICA" | "JURIDICA";
  document: string;
  name: string;
  email: string;
  phone: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

export interface ChargeDraft {
  cardTitle: string;
  items: ChargeItem[];
  totalCents: number;
  customer: ChargeCustomer;
  /** Pagador para o boleto: a organização (CNPJ e endereço) ou o contato (CPF). */
  payer: ChargePayer;
  charges: Charge[];
}

/** Valor mínimo de um pagamento na InfinitePay. */
export const MIN_CHARGE_CENTS = 100;

/** Telefone no formato da InfinitePay ("+55DDDNÚMERO"); null se não der para montar. */
export function chargePhone(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55") || d.length < 12 || d.length > 13) return null;
  return `+${d}`;
}

/**
 * Itens da cobrança a partir dos itens do cartão. Quantidade fracionada ou
 * desconto no item viram 1 × total da linha (a InfinitePay só aceita
 * quantidade inteira e preço unitário).
 */
export function chargeItemsFromCard(
  items: { description: string; quantity: number; unit_price_cents: number; discount_cents: number; total_cents: number }[],
): ChargeItem[] {
  return items
    .filter((i) => i.total_cents > 0)
    .map((i) =>
      Number.isInteger(i.quantity) && i.quantity > 0 && !i.discount_cents && i.unit_price_cents * i.quantity === i.total_cents
        ? { description: i.description.trim().slice(0, 200) || "Serviço", quantity: i.quantity, priceCents: i.unit_price_cents }
        : { description: i.description.trim().slice(0, 200) || "Serviço", quantity: 1, priceCents: i.total_cents },
    );
}

/** "R$ 52,00" com espaço comum (o Intl usa espaço não separável). */
export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

export const chargeTotal = (items: ChargeItem[]) => items.reduce((n, i) => n + i.quantity * i.priceCents, 0);

function rowToCharge(r: Record<string, unknown>): Charge {
  return { ...(r as unknown as Omit<Charge, "items">), items: JSON.parse(String(r.items_json)) as ChargeItem[] } as Charge;
}

export function listCharges(db: DatabaseSync, cardId: string): Charge[] {
  return many<Record<string, unknown>>(
    db,
    `SELECT id, card_id, provider, handle, order_nsu, url, amount_cents, description, items_json, due_date, status, paid_at, created_at,
       provider_ref, provider_env, provider_status, barcode, pix_code, pdf_doc_id, received_cents, checked_at
     FROM payment_charge WHERE card_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    cardId,
  ).map(rowToCharge);
}

/** Dados para a janela "Cobrança" do cartão. */
export function chargeDraftForCard(db: DatabaseSync, cardId: string): ChargeDraft {
  const card = one<{ title: string; person_id: string | null; organization_id: string | null; value_cents: number | null }>(
    db,
    "SELECT title, person_id, organization_id, value_cents FROM deal WHERE id = ? AND deleted_at IS NULL",
    cardId,
  );
  if (!card) throw new ValidationError("Cartão não encontrado.");
  const rows = many<{ description: string; quantity: number; unit_price_cents: number; discount_cents: number; total_cents: number }>(
    db,
    "SELECT description, quantity, unit_price_cents, discount_cents, total_cents FROM deal_item WHERE deal_id = ? AND deleted_at IS NULL ORDER BY position, created_at",
    cardId,
  );
  let items = chargeItemsFromCard(rows);
  // Sem itens: o valor do cartão, numa linha só.
  if (!items.length && card.value_cents && card.value_cents > 0) items = [{ description: card.title.slice(0, 200), quantity: 1, priceCents: card.value_cents }];

  // Comprador: o contato principal (nome, e-mail, telefone); sem ele, a organização.
  const person = card.person_id
    ? one<{ name: string; email: string | null; phone: string | null; cpf: string | null }>(db, "SELECT name, email, phone, cpf FROM person WHERE id = ? AND deleted_at IS NULL", card.person_id)
    : null;
  const org = card.organization_id
    ? one<{
        name: string;
        legal_name: string | null;
        email: string | null;
        phone: string | null;
        cnpj: string | null;
        cep: string | null;
        street: string | null;
        number: string | null;
        complement: string | null;
        district: string | null;
        city: string | null;
        state: string | null;
      }>(
        db,
        "SELECT name, legal_name, email, phone, cnpj, cep, street, number, complement, district, city, state FROM organization WHERE id = ? AND deleted_at IS NULL",
        card.organization_id,
      )
    : null;
  const customer: ChargeCustomer = {
    name: person?.name ?? org?.name ?? null,
    email: person?.email || org?.email || null,
    phone: chargePhone(person?.phone) ?? chargePhone(org?.phone),
  };
  // Boleto: com CNPJ, a organização (razão social e endereço); senão, o contato (CPF).
  const pj = !!org?.cnpj || (!person?.cpf && !!org);
  const payer: ChargePayer = {
    kind: pj ? "JURIDICA" : "FISICA",
    document: (pj ? org?.cnpj : person?.cpf) ?? "",
    name: (pj ? org?.legal_name || org?.name : person?.name) ?? "",
    email: (pj ? org?.email || person?.email : person?.email || org?.email) ?? "",
    phone: (person?.phone || org?.phone || "").replace(/[^\d+]/g, ""),
    cep: org?.cep ?? "",
    street: org?.street ?? "",
    number: org?.number ?? "",
    complement: org?.complement ?? "",
    district: org?.district ?? "",
    city: org?.city ?? "",
    state: org?.state ?? "",
  };
  return { cardTitle: card.title, items, totalCents: chargeTotal(items), customer, payer, charges: listCharges(db, cardId) };
}

/** Número do pedido enviado à InfinitePay (order_nsu): curto, único e rastreável. */
export function newOrderNsu(cardId: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/\D/g, "").slice(2, 14); // aammddhhmmss
  return `crm-${cardId.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8)}-${stamp}`;
}

/**
 * Texto da nota da cobrança no cartão (pronto para copiar e mandar ao cliente):
 *   Cobrança Claudia Tecnologia gerada:
 *   Valor: R$ 52,00
 *   Vencimento 14/11/2026
 *   Item: Certificado A3 - 24 meses
 *   Link de pagamento: https://…
 *   Pedido: crm-…
 */
export function chargeNoteText(c: {
  company?: string | null;
  amountCents: number;
  dueDate?: string | null;
  items: ChargeItem[];
  url?: string | null;
  orderNsu: string;
  barcode?: string | null;
  pixCode?: string | null;
}): string {
  const item = (i: ChargeItem) => (i.quantity > 1 ? `${i.quantity} × ${i.description}` : i.description);
  const lines = [`Cobrança ${c.company?.trim() || "InfinitePay"} gerada:`, `Valor: ${brl(c.amountCents)}`];
  if (c.dueDate) lines.push(`Vencimento ${c.dueDate.split("-").reverse().join("/")}`);
  if (c.items.length === 1) lines.push(`Item: ${item(c.items[0]!)}`);
  else lines.push("Itens:", ...c.items.map((i) => `- ${item(i)}`));
  if (c.url) lines.push(`Link de pagamento: ${c.url}`);
  if (c.barcode) lines.push(`Boleto (linha digitável): ${c.barcode}`);
  if (c.pixCode) lines.push(`Pix copia e cola: ${c.pixCode}`);
  lines.push(`Pedido: ${c.orderNsu}`);
  return lines.join("\n");
}

/** Grava a cobrança criada na InfinitePay e deixa uma nota no cartão. */
export function saveCharge(
  db: DatabaseSync,
  ctx: DbContext,
  cardId: string,
  input: { handle: string; orderNsu: string; url: string; items: ChargeItem[]; description: string; dueDate?: string | null; company?: string | null },
): string {
  if (!/^https:\/\//.test(input.url)) throw new ValidationError("Link de pagamento inválido.");
  if (!input.items.length) throw new ValidationError("A cobrança precisa de pelo menos um item.");
  const amount = chargeTotal(input.items);
  if (amount < MIN_CHARGE_CENTS) throw new ValidationError("O valor mínimo de uma cobrança é R$ 1,00.");
  const due = optionalText(input.dueDate);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ValidationError("Vencimento inválido.");
  return withTransaction(db, () => {
    if (!one(db, "SELECT 1 FROM deal WHERE id = ? AND deleted_at IS NULL", cardId)) throw new ValidationError("Cartão não encontrado.");
    const id = insertRow(db, ctx, "payment_charge", {
      card_id: cardId,
      provider: "infinitepay",
      handle: requireText(input.handle, "Conta InfinitePay"),
      order_nsu: requireText(input.orderNsu, "Número do pedido"),
      url: input.url,
      amount_cents: amount,
      description: requireText(input.description, "Descrição").slice(0, 200),
      items_json: JSON.stringify(input.items),
      due_date: due,
      status: "open",
    });
    insertRow(db, ctx, "note", {
      entity_type: "deal",
      entity_id: cardId,
      body: chargeNoteText({ company: input.company, amountCents: amount, dueDate: due, items: input.items, url: input.url, orderNsu: input.orderNsu }),
      document_ids: null,
    });
    return id;
  });
}

/** Baixa manual (o pagamento é visto na InfinitePay) ou cancelamento da cobrança no CRM. */
export function setChargeStatus(db: DatabaseSync, ctx: DbContext, id: string, status: "open" | "paid" | "canceled"): void {
  withTransaction(db, () => {
    const c = one<{ card_id: string; status: string; amount_cents: number; order_nsu: string; provider: string }>(
      db,
      "SELECT card_id, status, amount_cents, order_nsu, provider FROM payment_charge WHERE id = ? AND deleted_at IS NULL",
      id,
    );
    if (!c) throw new ValidationError("Cobrança não encontrada.");
    if (c.status === status) return;
    if (c.provider === "inter")
      throw new ValidationError(status === "canceled" ? "Cobrança do Inter: cancele pelo botão Cancelar (o boleto é cancelado no Inter)." : "Cobrança do Inter: a baixa vem do próprio Inter (Atualizar situação).");
    updateRow(db, ctx, "payment_charge", id, { status, paid_at: status === "paid" ? new Date().toISOString() : null });
    const valor = brl(c.amount_cents);
    const what = status === "paid" ? "marcada como paga" : status === "canceled" ? "cancelada no CRM (o link continua ativo na InfinitePay)" : "reaberta";
    insertRow(db, ctx, "note", { entity_type: "deal", entity_id: c.card_id, body: `Cobrança InfinitePay de ${valor} ${what}. Pedido: ${c.order_nsu}`, document_ids: null });
  });
}

/** Cartão da cobrança (para conferir acesso). */
export const chargeCardId = (db: DatabaseSync, id: string) => one<{ card_id: string }>(db, "SELECT card_id FROM payment_charge WHERE id = ?", id)?.card_id ?? null;

// ---------- Banco Inter (spec 22) ----------

const INTER_PAID = new Set(["RECEBIDO", "MARCADO_RECEBIDO"]);
const INTER_GONE = new Set(["CANCELADO", "EXPIRADO", "FALHA_EMISSAO"]);
export const interStatusOf = (situacao: string): Charge["status"] => (INTER_PAID.has(situacao) ? "paid" : INTER_GONE.has(situacao) ? "canceled" : "open");

/** Grava o boleto emitido no Inter e deixa a nota no cartão (pronta para copiar). */
export function saveInterCharge(
  db: DatabaseSync,
  ctx: DbContext,
  cardId: string,
  input: {
    env: "sandbox" | "producao";
    seuNumero: string;
    codigoSolicitacao: string;
    situacao: string;
    items: ChargeItem[];
    description: string;
    dueDate: string;
    company?: string | null;
    barcode?: string | null;
    pixCode?: string | null;
  },
): string {
  if (!input.items.length) throw new ValidationError("A cobrança precisa de pelo menos um item.");
  const amount = chargeTotal(input.items);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new ValidationError("Vencimento inválido.");
  return withTransaction(db, () => {
    if (!one(db, "SELECT 1 FROM deal WHERE id = ? AND deleted_at IS NULL", cardId)) throw new ValidationError("Cartão não encontrado.");
    const id = insertRow(db, ctx, "payment_charge", {
      card_id: cardId,
      provider: "inter",
      handle: input.env,
      order_nsu: requireText(input.seuNumero, "Seu número"),
      url: "",
      amount_cents: amount,
      description: requireText(input.description, "Descrição").slice(0, 200),
      items_json: JSON.stringify(input.items),
      due_date: input.dueDate,
      status: interStatusOf(input.situacao),
      provider_ref: requireText(input.codigoSolicitacao, "Código da cobrança"),
      provider_env: input.env,
      provider_status: input.situacao,
      barcode: optionalText(input.barcode),
      pix_code: optionalText(input.pixCode),
      checked_at: new Date().toISOString(),
    });
    insertRow(db, ctx, "note", {
      entity_type: "deal",
      entity_id: cardId,
      body: chargeNoteText({
        company: input.company,
        amountCents: amount,
        dueDate: input.dueDate,
        items: input.items,
        orderNsu: input.seuNumero,
        barcode: input.barcode,
        pixCode: input.pixCode,
      }),
      document_ids: null,
    });
    return id;
  });
}

/** Linha digitável / Pix que chegaram depois (emissão ainda em processamento). */
export function setInterCodes(db: DatabaseSync, ctx: DbContext, id: string, codes: { barcode?: string | null; pixCode?: string | null }): void {
  const c = one<{ barcode: string | null; pix_code: string | null }>(db, "SELECT barcode, pix_code FROM payment_charge WHERE id = ? AND deleted_at IS NULL", id);
  if (!c) throw new ValidationError("Cobrança não encontrada.");
  const data: Record<string, string> = {};
  if (codes.barcode && !c.barcode) data.barcode = codes.barcode;
  if (codes.pixCode && !c.pix_code) data.pix_code = codes.pixCode;
  if (Object.keys(data).length) updateRow(db, ctx, "payment_charge", id, data);
}

/** "Caixa Escolar … - 52,00 - Boleto C26111514300012". */
export function boletoDocumentName(payer: string, amountCents: number, seuNumero: string): string {
  const valor = (amountCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${payer.trim().slice(0, 80) || "Cliente"} - ${valor} - Boleto ${seuNumero}`;
}

/** PDF do boleto no GED (tipo "Boleto"), ligado ao cartão. */
export function saveChargePdf(db: DatabaseSync, ctx: DbContext, id: string, input: { file: FileRef; name: string }): string {
  return withTransaction(db, () => {
    const c = one<{ card_id: string; pdf_doc_id: string | null; order_nsu: string; barcode: string | null }>(
      db,
      "SELECT card_id, pdf_doc_id, order_nsu, barcode FROM payment_charge WHERE id = ? AND deleted_at IS NULL",
      id,
    );
    if (!c) throw new ValidationError("Cobrança não encontrada.");
    if (input.file.mime !== "application/pdf") throw new ValidationError("O boleto precisa ser um PDF.");
    if (c.pdf_doc_id && one(db, "SELECT 1 FROM document WHERE id = ? AND deleted_at IS NULL", c.pdf_doc_id)) return c.pdf_doc_id;
    let typeId = one<{ id: string }>(db, "SELECT id FROM document_type WHERE name = 'Boleto' COLLATE NOCASE AND deleted_at IS NULL")?.id;
    if (!typeId) {
      const pos = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM document_type WHERE deleted_at IS NULL")?.p ?? -1;
      typeId = insertRow(db, ctx, "document_type", { name: "Boleto", color: "amber", valid_days: null, position: pos + 1 });
    } else updateRow(db, ctx, "document_type", typeId, { active: 1 });
    const docId = createDocument(db, ctx, {
      name: input.name,
      typeId,
      docDate: new Date().toLocaleDateString("sv-SE"),
      description: `Boleto + Pix do Banco Inter. Pedido ${c.order_nsu}${c.barcode ? `. Linha digitável: ${c.barcode}` : ""}`,
      links: contextLinks(db, "deal", c.card_id),
      file: input.file,
    });
    updateRow(db, ctx, "payment_charge", id, { pdf_doc_id: docId });
    return docId;
  });
}

export interface InterOpenCharge {
  id: string;
  card_id: string;
  provider_ref: string;
  provider_env: "sandbox" | "producao";
  order_nsu: string;
  status: Charge["status"];
  provider_status: string | null;
}

/** Cobranças do Inter ainda em aberto (para consultar a situação). */
export function openInterCharges(db: DatabaseSync): InterOpenCharge[] {
  return many<InterOpenCharge>(
    db,
    `SELECT id, card_id, provider_ref, provider_env, order_nsu, status, provider_status FROM payment_charge
     WHERE provider = 'inter' AND status = 'open' AND deleted_at IS NULL AND provider_ref IS NOT NULL ORDER BY checked_at`,
  );
}

export interface InterSituacaoChange {
  /** Mudou a situação do CRM (aberta → paga/cancelada)? */
  changed: boolean;
  from: Charge["status"];
  to: Charge["status"];
  cardId: string;
  orderNsu: string;
  amountCents: number;
  paidDate: string | null;
}

/** Situação consultada no Inter → cobrança (e nota no cartão quando muda). */
export function applyInterSituacao(
  db: DatabaseSync,
  ctx: DbContext,
  id: string,
  r: { situacao: string; dataSituacao?: string | null; receivedCents?: number | null },
): InterSituacaoChange {
  return withTransaction(db, () => {
    const c = one<{ card_id: string; status: Charge["status"]; amount_cents: number; order_nsu: string; provider: string; provider_status: string | null }>(
      db,
      "SELECT card_id, status, amount_cents, order_nsu, provider, provider_status FROM payment_charge WHERE id = ? AND deleted_at IS NULL",
      id,
    );
    if (!c || c.provider !== "inter") throw new ValidationError("Cobrança do Inter não encontrada.");
    const to = interStatusOf(r.situacao);
    const day = r.dataSituacao && /^\d{4}-\d{2}-\d{2}/.test(r.dataSituacao) ? r.dataSituacao.slice(0, 10) : new Date().toLocaleDateString("sv-SE");
    const data: Record<string, string | number | null> = { provider_status: r.situacao, checked_at: new Date().toISOString() };
    if (to !== c.status) {
      data.status = to;
      data.paid_at = to === "paid" ? `${day}T12:00:00.000Z` : null;
      if (to === "paid" && r.receivedCents) data.received_cents = r.receivedCents;
    }
    updateRow(db, ctx, "payment_charge", id, data);
    if (to !== c.status || (c.provider_status !== r.situacao && r.situacao === "ATRASADO")) {
      const valor = brl(c.amount_cents);
      const what =
        to === "paid"
          ? `paga em ${day.split("-").reverse().join("/")}${r.receivedCents && r.receivedCents !== c.amount_cents ? ` (recebido ${brl(r.receivedCents)})` : ""}`
          : r.situacao === "EXPIRADO"
            ? "expirada (cancelada automaticamente pelo Inter)"
            : r.situacao === "FALHA_EMISSAO"
              ? "com falha na emissão no Inter"
              : to === "canceled"
                ? "cancelada no Inter"
                : r.situacao === "ATRASADO"
                  ? "vencida (ainda pode ser paga com multa e juros)"
                  : "reaberta";
      insertRow(db, ctx, "note", { entity_type: "deal", entity_id: c.card_id, body: `Cobrança Banco Inter de ${valor} ${what}. Pedido: ${c.order_nsu}`, document_ids: null });
    }
    return { changed: to !== c.status, from: c.status, to, cardId: c.card_id, orderNsu: c.order_nsu, amountCents: c.amount_cents, paidDate: to === "paid" ? day : null };
  });
}

/** Dados da cobrança do Inter para as chamadas (ambiente e código). */
export function interChargeRef(db: DatabaseSync, id: string): { card_id: string; provider_ref: string; provider_env: "sandbox" | "producao"; status: Charge["status"]; order_nsu: string; amount_cents: number } | null {
  return (
    one(db, "SELECT card_id, provider_ref, provider_env, status, order_nsu, amount_cents FROM payment_charge WHERE id = ? AND provider = 'inter' AND deleted_at IS NULL", id) ?? null
  );
}
