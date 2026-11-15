// Cobrança do cartão (spec 21): link de pagamento do checkout da InfinitePay.
// O CRM monta os itens a partir dos produtos e serviços do cartão, a extensão
// cria o link na InfinitePay e grava a cobrança aqui (com nota no cartão). A
// receita correspondente é lançada na Gestão Financeira pela aba Financeiro.
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

export interface Charge {
  id: string;
  card_id: string;
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
}

export interface ChargeDraft {
  cardTitle: string;
  items: ChargeItem[];
  totalCents: number;
  customer: ChargeCustomer;
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
    `SELECT id, card_id, handle, order_nsu, url, amount_cents, description, items_json, due_date, status, paid_at, created_at
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
    ? one<{ name: string; email: string | null; phone: string | null }>(db, "SELECT name, email, phone FROM person WHERE id = ? AND deleted_at IS NULL", card.person_id)
    : null;
  const org = card.organization_id
    ? one<{ name: string; email: string | null; phone: string | null }>(db, "SELECT name, email, phone FROM organization WHERE id = ? AND deleted_at IS NULL", card.organization_id)
    : null;
  const customer: ChargeCustomer = {
    name: person?.name ?? org?.name ?? null,
    email: person?.email || org?.email || null,
    phone: chargePhone(person?.phone) ?? chargePhone(org?.phone),
  };
  return { cardTitle: card.title, items, totalCents: chargeTotal(items), customer, charges: listCharges(db, cardId) };
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
export function chargeNoteText(c: { company?: string | null; amountCents: number; dueDate?: string | null; items: ChargeItem[]; url: string; orderNsu: string }): string {
  const item = (i: ChargeItem) => (i.quantity > 1 ? `${i.quantity} × ${i.description}` : i.description);
  const lines = [`Cobrança ${c.company?.trim() || "InfinitePay"} gerada:`, `Valor: ${brl(c.amountCents)}`];
  if (c.dueDate) lines.push(`Vencimento ${c.dueDate.split("-").reverse().join("/")}`);
  if (c.items.length === 1) lines.push(`Item: ${item(c.items[0]!)}`);
  else lines.push("Itens:", ...c.items.map((i) => `- ${item(i)}`));
  lines.push(`Link de pagamento: ${c.url}`, `Pedido: ${c.orderNsu}`);
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
    const c = one<{ card_id: string; status: string; amount_cents: number; order_nsu: string }>(
      db,
      "SELECT card_id, status, amount_cents, order_nsu FROM payment_charge WHERE id = ? AND deleted_at IS NULL",
      id,
    );
    if (!c) throw new ValidationError("Cobrança não encontrada.");
    if (c.status === status) return;
    updateRow(db, ctx, "payment_charge", id, { status, paid_at: status === "paid" ? new Date().toISOString() : null });
    const valor = brl(c.amount_cents);
    const what = status === "paid" ? "marcada como paga" : status === "canceled" ? "cancelada no CRM (o link continua ativo na InfinitePay)" : "reaberta";
    insertRow(db, ctx, "note", { entity_type: "deal", entity_id: c.card_id, body: `Cobrança InfinitePay de ${valor} ${what}. Pedido: ${c.order_nsu}`, document_ids: null });
  });
}

/** Cartão da cobrança (para conferir acesso). */
export const chargeCardId = (db: DatabaseSync, id: string) => one<{ card_id: string }>(db, "SELECT card_id FROM payment_charge WHERE id = ?", id)?.card_id ?? null;
