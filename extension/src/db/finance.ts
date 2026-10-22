// Financeiro do cartão (spec 13, Fase 2): o dinheiro mora na Gestão
// Financeira; aqui fica quem é o cliente/fornecedor do cartão (o que vai no
// pedido de lançamento) e a cópia local dos lançamentos lidos de lá, para a
// aba Financeiro funcionar mesmo com a outra extensão fechada.
import { PACKAGE_FORMAT, type ContactCard, type FinanceItem, type PackageRequest, type RequestsPackage, type ReturnPackage } from "../lib/finance/protocol";
import { contactCardFor, organizationCard, personCard } from "./contactCard";
import { ValidationError } from "../lib/validate";
import { formatCents } from "../lib/format";
import { cardScope } from "./deals";
import { updateRow, type DbContext } from "./repo";
import { many, one, run, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import type { Viewer } from "./users";

/** Cliente/fornecedor padrão do cartão (ficha completa): a organização; sem ela, o contato principal. */
export function cardCounterparty(db: DatabaseSync, dealId: string): ContactCard | null {
  const d = one<{ person_id: string | null; organization_id: string | null }>(
    db,
    "SELECT person_id, organization_id FROM deal WHERE id = ? AND deleted_at IS NULL",
    dealId,
  );
  if (!d) return null;
  return (d.organization_id ? organizationCard(db, d.organization_id) : null) ?? (d.person_id ? personCard(db, d.person_id) : null);
}

// ---------- Paridade de cadastros: quem está na Gestão Financeira ----------

/** Passa a acompanhar o contato/organização na Gestão Financeira (`sent` = a ficha acabou de ir junto, ex.: no lançamento). */
export function linkFinanceContact(db: DatabaseSync, ctx: DbContext, crmRef: string, sent = false): void {
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO finance_contact (crm_ref, workspace_id, pending, linked_at, sent_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(crm_ref) DO UPDATE SET pending = excluded.pending, sent_at = COALESCE(excluded.sent_at, finance_contact.sent_at)`,
    crmRef,
    ctx.workspaceId,
    sent ? 0 : 1,
    now,
    sent ? now : null,
  );
}

/**
 * Cadastro alterado no CRM: se já está na Gestão Financeira, fica pendente de
 * envio. Organização alterada também atualiza os contatos dela que estão lá
 * (a ficha deles leva o nome da empresa).
 */
export function markContactChanged(db: DatabaseSync, entity: "person" | "organization", id: string): void {
  run(db, "UPDATE finance_contact SET pending = 1 WHERE crm_ref = ?", `${entity}:${id}`);
  if (entity === "organization")
    run(
      db,
      `UPDATE finance_contact SET pending = 1 WHERE crm_ref IN (
         SELECT 'person:' || po.person_id FROM person_organization po WHERE po.organization_id = ? AND po.deleted_at IS NULL)`,
      id,
    );
}

/** Situação na Gestão Financeira (null = ainda não está lá). */
export function financeContactStatus(db: DatabaseSync, crmRef: string): { pending: boolean; linkedAt: string; sentAt: string | null } | null {
  const r = one<{ pending: number; linked_at: string; sent_at: string | null }>(db, "SELECT pending, linked_at, sent_at FROM finance_contact WHERE crm_ref = ?", crmRef);
  return r ? { pending: !!r.pending, linkedAt: r.linked_at, sentAt: r.sent_at } : null;
}

/** Fichas a enviar (alteradas ou recém-ligadas); as excluídas do CRM saem da fila. */
export function pendingContactCards(db: DatabaseSync, limit = 500): ContactCard[] {
  const out: ContactCard[] = [];
  for (const r of many<{ crm_ref: string }>(db, "SELECT crm_ref FROM finance_contact WHERE pending = 1 ORDER BY linked_at LIMIT ?", limit)) {
    const card = contactCardFor(db, r.crm_ref);
    if (card) out.push(card);
    else run(db, "UPDATE finance_contact SET pending = 0 WHERE crm_ref = ?", r.crm_ref);
  }
  return out;
}

export function markContactsSent(db: DatabaseSync, crmRefs: string[], at = new Date().toISOString()): void {
  withTransaction(db, () => {
    for (const ref of crmRefs) run(db, "UPDATE finance_contact SET pending = 0, sent_at = ? WHERE crm_ref = ?", at, ref);
  });
}

export interface FinanceEntry extends FinanceItem {
  dealId: string;
}

export interface CardFinance {
  entries: FinanceEntry[];
  /** Última leitura da Gestão Financeira (null = nunca leu). */
  syncedAt: string | null;
  env: string | null;
  summary: FinanceSummary;
}

export interface FinanceSummary {
  incomeCents: number;
  incomePaidCents: number;
  expenseCents: number;
  expensePaidCents: number;
  /** Receitas - despesas (previsto: tudo; realizado: só o pago/recebido). */
  resultCents: number;
  resultPaidCents: number;
  overdueCount: number;
}

export function summarize(entries: FinanceItem[], today = new Date().toISOString().slice(0, 10)): FinanceSummary {
  const s: FinanceSummary = { incomeCents: 0, incomePaidCents: 0, expenseCents: 0, expensePaidCents: 0, resultCents: 0, resultPaidCents: 0, overdueCount: 0 };
  for (const e of entries) {
    const paid = e.status === "paid";
    if (e.type === "income") {
      s.incomeCents += e.amountCents;
      if (paid) s.incomePaidCents += e.amountCents;
    } else {
      s.expenseCents += e.amountCents;
      if (paid) s.expensePaidCents += e.amountCents;
    }
    if (!paid && (e.dueDate ?? e.competenceDate) < today) s.overdueCount++;
  }
  s.resultCents = s.incomeCents - s.expenseCents;
  s.resultPaidCents = s.incomePaidCents - s.expensePaidCents;
  return s;
}

const COLS = `id, deal_id AS dealId, code, type, status, description, amount_cents AS amountCents, competence_date AS competenceDate,
  due_date AS dueDate, payment_date AS paymentDate, category, subcategory, cost_center AS costCenter, cost_subcenter AS costSubcenter,
  counterparty, wallet, account, credit_card AS creditCard, installment_number AS installmentNumber, installment_total AS installmentTotal`;

export function cardFinance(db: DatabaseSync, dealId: string): CardFinance {
  const entries = many<FinanceEntry>(db, `SELECT ${COLS}, deal_id AS ref FROM finance_entry WHERE deal_id = ? ORDER BY COALESCE(due_date, competence_date), id`, dealId);
  const sync = one<{ env: string; synced_at: string }>(db, "SELECT env, synced_at FROM finance_sync WHERE deal_id = ?", dealId);
  return { entries, syncedAt: sync?.synced_at ?? null, env: sync?.env ?? null, summary: summarize(entries) };
}

/** Substitui a cópia local pelos lançamentos lidos agora da Gestão Financeira (cartões pedidos, mesmo os sem lançamento). */
export function replaceFinance(db: DatabaseSync, ctx: DbContext, dealIds: string[], items: FinanceItem[], env: string, at: string): void {
  withTransaction(db, () => {
    for (const dealId of dealIds) {
      run(db, "DELETE FROM finance_entry WHERE deal_id = ?", dealId);
      run(
        db,
        "INSERT INTO finance_sync (deal_id, workspace_id, env, synced_at) VALUES (?, ?, ?, ?) ON CONFLICT(deal_id) DO UPDATE SET env = excluded.env, synced_at = excluded.synced_at",
        dealId,
        ctx.workspaceId,
        env,
        at,
      );
    }
    const wanted = new Set(dealIds);
    for (const i of items) {
      if (!wanted.has(i.ref)) continue;
      run(
        db,
        `INSERT OR REPLACE INTO finance_entry (id, workspace_id, deal_id, code, type, status, description, amount_cents, competence_date, due_date, payment_date,
           category, subcategory, cost_center, cost_subcenter, counterparty, wallet, account, credit_card, installment_number, installment_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        i.id,
        ctx.workspaceId,
        i.ref,
        i.code,
        i.type,
        i.status,
        i.description,
        i.amountCents,
        i.competenceDate,
        i.dueDate,
        i.paymentDate,
        i.category,
        i.subcategory,
        i.costCenter,
        i.costSubcenter,
        i.counterparty,
        i.wallet,
        i.account,
        i.creditCard,
        i.installmentNumber,
        i.installmentTotal,
      );
    }
  });
}

// ---------- Fase 3: visão geral ----------

/** Cópia de todos os lançamentos vindos do CRM (leitura geral, para relatórios e financeiro do cliente). */
export function replaceAllFinance(db: DatabaseSync, ctx: DbContext, items: FinanceItem[], env: string, at: string): void {
  withTransaction(db, () => {
    const known = many<{ deal_id: string }>(db, "SELECT deal_id FROM finance_sync WHERE deal_id <> '*'").map((r) => r.deal_id);
    const ids = [...new Set([...known, ...items.map((i) => i.ref), "*"])];
    run(db, "DELETE FROM finance_entry");
    replaceFinance(db, ctx, ids, items, env, at);
  });
}

/** Última leitura geral (todos os cartões). */
export function financeSyncedAt(db: DatabaseSync): { at: string; env: string } | null {
  const r = one<{ synced_at: string; env: string }>(db, "SELECT synced_at, env FROM finance_sync WHERE deal_id = '*'");
  return r ? { at: r.synced_at, env: r.env } : null;
}

export type FinanceBasis = "competencia" | "vencimento" | "caixa";

export const FINANCE_BASIS_LABEL: Record<FinanceBasis, string> = {
  competencia: "Competência",
  vencimento: "Vencimento",
  caixa: "Caixa (pago/recebido)",
};

export interface FinanceReportFilter {
  /** Datas locais "AAAA-MM-DD", fim inclusive. */
  start: string;
  end: string;
  basis: FinanceBasis;
  pipelineId?: string | null;
  ownerIds?: string[] | null;
  cardStatus?: "open" | "won" | "lost" | null;
  viewer?: Viewer | null;
  /** "Hoje" para atrasados (AAAA-MM-DD). */
  today?: string;
}

export interface FinanceTotals {
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
  /** Resultado ÷ receitas; null sem receita. */
  margin: number | null;
  incomePaidCents: number;
  expensePaidCents: number;
  receivableCents: number;
  payableCents: number;
  overdueReceivableCents: number;
  overduePayableCents: number;
}

export interface FinanceCardRow extends FinanceTotals {
  id: string;
  title: string;
  pipelineId: string;
  pipelineName: string;
  client: string | null;
  status: "open" | "won" | "lost";
  valueCents: number;
}

export interface FinanceGroupRow extends FinanceTotals {
  name: string;
  cards: number;
}

export interface FinanceReport {
  totals: FinanceTotals;
  cards: FinanceCardRow[];
  pipelines: FinanceGroupRow[];
  clients: FinanceGroupRow[];
  categories: { type: "income" | "expense"; name: string; amountCents: number }[];
  months: { month: string; incomeCents: number; expenseCents: number; resultCents: number }[];
  /** Cartões ganhos com valor ainda não lançado como receita (qualquer data). */
  toBill: { id: string; title: string; pipelineId: string; client: string | null; closedAt: string | null; valueCents: number; launchedCents: number; missingCents: number }[];
  syncedAt: string | null;
  env: string | null;
}

const emptyTotals = (): FinanceTotals => ({
  incomeCents: 0,
  expenseCents: 0,
  resultCents: 0,
  margin: null,
  incomePaidCents: 0,
  expensePaidCents: 0,
  receivableCents: 0,
  payableCents: 0,
  overdueReceivableCents: 0,
  overduePayableCents: 0,
});

function add(t: FinanceTotals, e: FinanceItem, today: string): void {
  const paid = e.status === "paid";
  const late = !paid && (e.dueDate ?? e.competenceDate) < today;
  if (e.type === "income") {
    t.incomeCents += e.amountCents;
    if (paid) t.incomePaidCents += e.amountCents;
    else {
      t.receivableCents += e.amountCents;
      if (late) t.overdueReceivableCents += e.amountCents;
    }
  } else {
    t.expenseCents += e.amountCents;
    if (paid) t.expensePaidCents += e.amountCents;
    else {
      t.payableCents += e.amountCents;
      if (late) t.overduePayableCents += e.amountCents;
    }
  }
  t.resultCents = t.incomeCents - t.expenseCents;
  t.margin = t.incomeCents ? t.resultCents / t.incomeCents : null;
}

const entryDate = (e: FinanceItem, basis: FinanceBasis): string | null =>
  basis === "competencia" ? e.competenceDate : basis === "vencimento" ? (e.dueDate ?? e.competenceDate) : e.status === "paid" ? e.paymentDate : null;

interface ScopedCard {
  id: string;
  title: string;
  pipeline_id: string;
  pipeline_name: string;
  status: "open" | "won" | "lost";
  value_cents: number;
  closed_at: string | null;
  /** "Não registrar no financeiro". */
  finance_skip: number;
  client: string | null;
}

function scopedCards(db: DatabaseSync, f: { pipelineId?: string | null; ownerIds?: string[] | null; cardStatus?: string | null; viewer?: Viewer | null }, extra = ""): ScopedCard[] {
  const where = ["d.deleted_at IS NULL", "p.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (f.pipelineId) {
    where.push("d.pipeline_id = ?");
    params.push(f.pipelineId);
  }
  if (f.ownerIds?.length) {
    where.push(`d.owner_id IN (${f.ownerIds.map(() => "?").join(", ")})`);
    params.push(...f.ownerIds);
  }
  if (f.cardStatus) {
    where.push("d.status = ?");
    params.push(f.cardStatus);
  }
  const scope = cardScope(db, f.viewer);
  return many<ScopedCard>(
    db,
    `SELECT d.id, d.title, d.pipeline_id, p.name AS pipeline_name, d.status, d.value_cents, d.closed_at, d.finance_skip,
            COALESCE(o.name, pe.name) AS client
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id
     LEFT JOIN organization o ON o.id = d.organization_id AND o.deleted_at IS NULL
     LEFT JOIN person pe ON pe.id = d.person_id AND pe.deleted_at IS NULL
     WHERE ${where.join(" AND ")}${extra}${scope.sql}`,
    ...params,
    ...scope.params,
  );
}

const ENTRY_COLS = `id, deal_id AS ref, code, type, status, description, amount_cents AS amountCents, competence_date AS competenceDate,
  due_date AS dueDate, payment_date AS paymentDate, category, subcategory, cost_center AS costCenter, cost_subcenter AS costSubcenter,
  counterparty, wallet, account, credit_card AS creditCard, installment_number AS installmentNumber, installment_total AS installmentTotal`;

/** Relatórios → Financeiro: receitas e despesas lançadas pelos cartões, no período e no escopo do filtro. */
export function financeReport(db: DatabaseSync, f: FinanceReportFilter): FinanceReport {
  const today = f.today ?? new Date().toLocaleDateString("sv-SE");
  const cards = new Map(scopedCards(db, f).map((c) => [c.id, c]));
  const entries = many<FinanceItem>(db, `SELECT ${ENTRY_COLS} FROM finance_entry`).filter((e) => {
    if (!cards.has(e.ref)) return false;
    const d = entryDate(e, f.basis);
    return !!d && d >= f.start && d <= f.end;
  });

  const totals = emptyTotals();
  const byCard = new Map<string, FinanceTotals>();
  const byPipeline = new Map<string, FinanceGroupRow & { ids: Set<string> }>();
  const byClient = new Map<string, FinanceGroupRow & { ids: Set<string> }>();
  const byCategory = new Map<string, { type: "income" | "expense"; name: string; amountCents: number }>();
  const byMonth = new Map<string, { incomeCents: number; expenseCents: number }>();
  const group = (m: Map<string, FinanceGroupRow & { ids: Set<string> }>, key: string, cardId: string, e: FinanceItem) => {
    const g = m.get(key) ?? { name: key, cards: 0, ids: new Set<string>(), ...emptyTotals() };
    g.ids.add(cardId);
    g.cards = g.ids.size;
    add(g, e, today);
    m.set(key, g);
  };
  for (const e of entries) {
    const c = cards.get(e.ref)!;
    add(totals, e, today);
    const t = byCard.get(c.id) ?? emptyTotals();
    add(t, e, today);
    byCard.set(c.id, t);
    group(byPipeline, c.pipeline_name, c.id, e);
    group(byClient, c.client ?? "Sem cliente", c.id, e);
    const cat = e.category ? (e.subcategory ? `${e.category} › ${e.subcategory}` : e.category) : "Sem categoria";
    const ck = `${e.type}|${cat}`;
    const cr = byCategory.get(ck) ?? { type: e.type, name: cat, amountCents: 0 };
    cr.amountCents += e.amountCents;
    byCategory.set(ck, cr);
    const month = entryDate(e, f.basis)!.slice(0, 7);
    const mr = byMonth.get(month) ?? { incomeCents: 0, expenseCents: 0 };
    if (e.type === "income") mr.incomeCents += e.amountCents;
    else mr.expenseCents += e.amountCents;
    byMonth.set(month, mr);
  }

  // Meses contínuos do período (até 60).
  const months: FinanceReport["months"] = [];
  const [ys, ms] = f.start.split("-").map(Number);
  const endMonth = f.end.slice(0, 7);
  for (let i = 0; i < 60; i++) {
    const d = new Date(ys!, ms! - 1 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key > endMonth) break;
    const m = byMonth.get(key) ?? { incomeCents: 0, expenseCents: 0 };
    months.push({ month: key, ...m, resultCents: m.incomeCents - m.expenseCents });
  }

  // Ganhos (no período, pela data do ganho) com receita ainda por lançar — tudo o que já foi lançado conta.
  const launched = new Map(
    many<{ deal_id: string; total: number }>(db, "SELECT deal_id, SUM(amount_cents) AS total FROM finance_entry WHERE type = 'income' GROUP BY deal_id").map((r) => [r.deal_id, r.total]),
  );
  const toBill = [...cards.values()]
    .filter((c) => c.status === "won" && !c.finance_skip && c.value_cents > 0 && !!c.closed_at && toLocalDate(c.closed_at) >= f.start && toLocalDate(c.closed_at) <= f.end)
    .map((c) => {
      const l = launched.get(c.id) ?? 0;
      return { id: c.id, title: c.title, pipelineId: c.pipeline_id, client: c.client, closedAt: c.closed_at, valueCents: c.value_cents, launchedCents: l, missingCents: c.value_cents - l };
    })
    .filter((r) => r.missingCents > 0)
    .sort((a, b) => b.missingCents - a.missingCents);

  const strip = (m: Map<string, FinanceGroupRow & { ids: Set<string> }>) =>
    [...m.values()].map(({ ids: _ids, ...g }) => g).sort((a, b) => b.resultCents - a.resultCents || a.name.localeCompare(b.name));
  const sync = financeSyncedAt(db);
  return {
    totals,
    cards: [...byCard.entries()]
      .map(([id, t]) => {
        const c = cards.get(id)!;
        return { id, title: c.title, pipelineId: c.pipeline_id, pipelineName: c.pipeline_name, client: c.client, status: c.status, valueCents: c.value_cents, ...t };
      })
      .sort((a, b) => b.resultCents - a.resultCents || a.title.localeCompare(b.title)),
    pipelines: strip(byPipeline),
    clients: strip(byClient),
    categories: [...byCategory.values()].sort((a, b) => (a.type === b.type ? b.amountCents - a.amountCents : a.type === "income" ? -1 : 1)),
    months,
    toBill,
    syncedAt: sync?.at ?? null,
    env: sync?.env ?? null,
  };
}

function toLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE");
}

export interface ClientFinance {
  totals: FinanceTotals;
  cards: (FinanceTotals & { id: string; title: string; pipelineId: string; pipelineName: string; status: "open" | "won" | "lost"; valueCents: number })[];
  /** Receitas em aberto do cliente (a receber), por vencimento. */
  receivables: (FinanceItem & { cardTitle: string })[];
  syncedAt: string | null;
}

/** Financeiro do cliente: tudo o que foi lançado nos cartões da organização (ou do contato). */
export function clientFinance(db: DatabaseSync, f: { organizationId?: string; personId?: string }, viewer?: Viewer | null, today = new Date().toLocaleDateString("sv-SE")): ClientFinance {
  const id = f.organizationId ?? f.personId;
  const extra = f.organizationId
    ? " AND d.organization_id = ?"
    : " AND d.person_id = ?"; // contato principal do cartão
  const cards = new Map(
    scopedCardsFor(db, extra, id ?? "", viewer).map((c) => [c.id, c]),
  );
  const entries = cards.size
    ? many<FinanceItem>(db, `SELECT ${ENTRY_COLS} FROM finance_entry WHERE deal_id IN (${[...cards.keys()].map(() => "?").join(", ")})`, ...cards.keys())
    : [];
  const totals = emptyTotals();
  const byCard = new Map<string, FinanceTotals>();
  for (const e of entries) {
    add(totals, e, today);
    const t = byCard.get(e.ref) ?? emptyTotals();
    add(t, e, today);
    byCard.set(e.ref, t);
  }
  return {
    totals,
    cards: [...byCard.entries()]
      .map(([cid, t]) => {
        const c = cards.get(cid)!;
        return { id: cid, title: c.title, pipelineId: c.pipeline_id, pipelineName: c.pipeline_name, status: c.status, valueCents: c.value_cents, ...t };
      })
      .sort((a, b) => b.incomeCents - a.incomeCents),
    receivables: entries
      .filter((e) => e.type === "income" && e.status === "pending")
      .map((e) => ({ ...e, cardTitle: cards.get(e.ref)!.title }))
      .sort((a, b) => (a.dueDate ?? a.competenceDate).localeCompare(b.dueDate ?? b.competenceDate)),
    syncedAt: financeSyncedAt(db)?.at ?? null,
  };
}

function scopedCardsFor(db: DatabaseSync, extra: string, id: string, viewer?: Viewer | null): ScopedCard[] {
  const scope = cardScope(db, viewer);
  return many<ScopedCard>(
    db,
    `SELECT d.id, d.title, d.pipeline_id, p.name AS pipeline_name, d.status, d.value_cents, d.closed_at, d.finance_skip, NULL AS client
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id
     WHERE d.deleted_at IS NULL${extra}${scope.sql}`,
    id,
    ...scope.params,
  );
}

// ---------- Fase 4: modo pacote ----------

export interface FinanceRequestInput {
  mode: "income" | "expense";
  description: string;
  amountCents: number | null;
  dueDate?: string | null;
  competenceDate?: string | null;
  notes?: string | null;
}

export interface FinanceRequestRow {
  id: string;
  dealId: string;
  status: "pending" | "exported" | "launched";
  createdAt: string;
  exportedAt: string | null;
  launchedAt: string | null;
  request: PackageRequest;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pedido de lançamento para ir no pacote (cliente/fornecedor = o do cartão). */
export function createFinanceRequest(db: DatabaseSync, ctx: DbContext, dealId: string, input: FinanceRequestInput): string {
  const card = one<{ title: string; kind: string }>(db, "SELECT title, kind FROM deal WHERE id = ? AND deleted_at IS NULL", dealId);
  if (!card) throw new ValidationError("Cartão não encontrado.");
  const counterparty = cardCounterparty(db, dealId);
  if (!counterparty) throw new ValidationError("Para lançar no financeiro, vincule uma organização ou um contato a este cartão.");
  // O cliente/fornecedor passa a ser acompanhado (alterações no CRM vão nos próximos pacotes).
  linkFinanceContact(db, ctx, counterparty.crmRef);
  if (input.mode !== "income" && input.mode !== "expense") throw new ValidationError("Tipo inválido.");
  const description = input.description.trim();
  if (!description) throw new ValidationError("Informe a descrição.");
  if (input.amountCents != null && (!Number.isInteger(input.amountCents) || input.amountCents <= 0)) throw new ValidationError("Valor inválido.");
  for (const d of [input.dueDate, input.competenceDate]) if (d && !DATE.test(d)) throw new ValidationError("Data inválida.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const noun = card.kind === "deal" ? "Negócio" : card.kind === "ticket" ? "Ticket" : "Projeto";
  const request: PackageRequest = {
    id,
    mode: input.mode,
    description,
    amountCents: input.amountCents,
    dueDate: input.dueDate || null,
    competenceDate: input.competenceDate || null,
    notes: input.notes?.trim() || null,
    counterparty,
    origin: { app: "conectcrm", ref: dealId, label: `${noun} "${card.title}" (ConectCRM)` },
    walletId: "empresa",
    createdAt: now,
    createdBy: ctx.userId,
  };
  run(
    db,
    "INSERT INTO finance_request (id, workspace_id, deal_id, payload, status, created_at, created_by) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
    id,
    ctx.workspaceId,
    dealId,
    JSON.stringify(request),
    now,
    ctx.userId,
  );
  return id;
}

const mapRequest = (r: { id: string; deal_id: string; status: FinanceRequestRow["status"]; created_at: string; exported_at: string | null; launched_at: string | null; payload: string }): FinanceRequestRow => ({
  id: r.id,
  dealId: r.deal_id,
  status: r.status,
  createdAt: r.created_at,
  exportedAt: r.exported_at,
  launchedAt: r.launched_at,
  request: JSON.parse(r.payload) as PackageRequest,
});

const REQ_COLS = "id, deal_id, status, created_at, exported_at, launched_at, payload";

/** Pedidos do cartão ainda não lançados na Gestão Financeira. */
export function listFinanceRequests(db: DatabaseSync, dealId: string): FinanceRequestRow[] {
  return many<Parameters<typeof mapRequest>[0]>(
    db,
    `SELECT ${REQ_COLS} FROM finance_request WHERE deal_id = ? AND deleted_at IS NULL AND status <> 'launched' ORDER BY created_at`,
    dealId,
  ).map(mapRequest);
}

/** Quantos pedidos aguardam ir (ou voltar) da Gestão Financeira. */
export function financeRequestCounts(db: DatabaseSync): { pending: number; exported: number; contacts: number } {
  const r = one<{ pending: number; exported: number }>(
    db,
    `SELECT SUM(status = 'pending') AS pending, SUM(status = 'exported') AS exported FROM finance_request d
     WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM deal WHERE deal.id = d.deal_id AND deal.deleted_at IS NULL)`,
  );
  const contacts = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM finance_contact WHERE pending = 1")?.n ?? 0;
  return { pending: r?.pending ?? 0, exported: r?.exported ?? 0, contacts };
}

export function discardFinanceRequest(db: DatabaseSync, id: string): string {
  const r = one<{ deal_id: string; status: string }>(db, "SELECT deal_id, status FROM finance_request WHERE id = ? AND deleted_at IS NULL", id);
  if (!r) throw new ValidationError("Pedido não encontrado.");
  if (r.status === "launched") throw new ValidationError("Este pedido já foi lançado na Gestão Financeira; exclua lá.");
  run(db, "UPDATE finance_request SET deleted_at = ? WHERE id = ?", new Date().toISOString(), id);
  return r.deal_id;
}

/**
 * Pacote com os pedidos que ainda não voltaram lançados (os já exportados vão
 * de novo: a Gestão Financeira ignora os repetidos).
 */
export function exportFinanceRequests(db: DatabaseSync, version: string, now = new Date()): RequestsPackage {
  const rows = many<Parameters<typeof mapRequest>[0]>(
    db,
    `SELECT ${REQ_COLS} FROM finance_request f WHERE deleted_at IS NULL AND status IN ('pending', 'exported')
       AND EXISTS (SELECT 1 FROM deal WHERE deal.id = f.deal_id AND deal.deleted_at IS NULL) ORDER BY created_at`,
  ).map(mapRequest);
  const at = now.toISOString();
  // Contatos/organizações alterados (ou enviados pelo botão) vão juntos.
  const contacts = pendingContactCards(db);
  withTransaction(db, () => {
    for (const r of rows) if (r.status === "pending") run(db, "UPDATE finance_request SET status = 'exported', exported_at = ? WHERE id = ?", at, r.id);
    markContactsSent(db, contacts.map((c) => c.crmRef), at);
  });
  return { format: PACKAGE_FORMAT, version: 1, kind: "requests", createdAt: at, from: { app: "conectcrm", version }, requests: rows.map((r) => r.request), contacts };
}

/** Importa o retorno da Gestão Financeira: substitui a cópia e marca os pedidos que viraram lançamento. */
export function importFinanceReturn(db: DatabaseSync, ctx: DbContext, pkg: ReturnPackage): { items: number; launched: number } {
  return withTransaction(db, () => {
    replaceAllFinance(db, ctx, pkg.items, pkg.env, pkg.createdAt);
    const ids = [...new Set(pkg.items.map((i) => i.requestId).filter((x): x is string => !!x))];
    let launched = 0;
    for (const id of ids) launched += run(db, "UPDATE finance_request SET status = 'launched', launched_at = ? WHERE id = ? AND status <> 'launched'", pkg.createdAt, id);
    return { items: pkg.items.length, launched };
  });
}

// ---------- Fase 4: alertas ----------

export interface FinanceAlerts {
  /** A integração está em uso (já leu da Gestão Financeira ou fez pedidos). */
  inUse: boolean;
  overdueReceivables: { cardId: string; cardTitle: string; client: string | null; description: string; amountCents: number; dueDate: string; daysLate: number }[];
  dueSoon: { cardId: string; cardTitle: string; client: string | null; description: string; amountCents: number; dueDate: string }[];
  overduePayables: { count: number; amountCents: number };
  /** Ganhos há mais de `wonDays` dias com valor ainda não lançado como receita (nem pedido no pacote). */
  wonWithoutIncome: { cardId: string; cardTitle: string; client: string | null; valueCents: number; missingCents: number; closedAt: string; days: number }[];
  syncedAt: string | null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

/** "Não registrar no financeiro" (ao ganhar/concluir): o cartão sai dos avisos de receita a lançar. */
export function setFinanceSkip(db: DatabaseSync, ctx: DbContext, dealId: string, skip: boolean): void {
  if (!one(db, "SELECT 1 FROM deal WHERE id = ? AND deleted_at IS NULL", dealId)) throw new ValidationError("Cartão não encontrado.");
  updateRow(db, ctx, "deal", dealId, { finance_skip: skip ? 1 : 0 });
}

/** Pontos de atenção financeiros dos cartões que o usuário vê (ou só os de um responsável). */
export function financeAlerts(
  db: DatabaseSync,
  viewer: Viewer | null,
  opts: { today?: string; ownerIds?: string[] | null; wonDays?: number; soonDays?: number } = {},
): FinanceAlerts {
  const today = opts.today ?? new Date().toLocaleDateString("sv-SE");
  const inUse = !!one(db, "SELECT 1 FROM finance_sync LIMIT 1") || !!one(db, "SELECT 1 FROM finance_request WHERE deleted_at IS NULL LIMIT 1");
  const cards = new Map(scopedCards(db, { ownerIds: opts.ownerIds, viewer }).map((c) => [c.id, c]));
  const entries = many<FinanceItem>(db, `SELECT ${ENTRY_COLS} FROM finance_entry WHERE status = 'pending'`).filter((e) => cards.has(e.ref));
  const soonLimit = new Date(Date.parse(`${today}T12:00:00`) + (opts.soonDays ?? 7) * 86_400_000).toLocaleDateString("sv-SE");
  const out: FinanceAlerts = { inUse, overdueReceivables: [], dueSoon: [], overduePayables: { count: 0, amountCents: 0 }, wonWithoutIncome: [], syncedAt: financeSyncedAt(db)?.at ?? null };
  for (const e of entries) {
    const c = cards.get(e.ref)!;
    const due = e.dueDate ?? e.competenceDate;
    if (e.type === "income") {
      const base = { cardId: c.id, cardTitle: c.title, client: c.client, description: e.description, amountCents: e.amountCents, dueDate: due };
      if (due < today) out.overdueReceivables.push({ ...base, daysLate: daysBetween(due, today) });
      else if (due <= soonLimit) out.dueSoon.push(base);
    } else if (due < today) {
      out.overduePayables.count++;
      out.overduePayables.amountCents += e.amountCents;
    }
  }
  out.overdueReceivables.sort((a, b) => b.daysLate - a.daysLate);
  out.dueSoon.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  if (inUse) {
    const launched = new Map(
      many<{ deal_id: string; total: number }>(db, "SELECT deal_id, SUM(amount_cents) AS total FROM finance_entry WHERE type = 'income' GROUP BY deal_id").map((r) => [r.deal_id, r.total]),
    );
    const asked = new Map<string, number>();
    for (const r of many<{ deal_id: string; payload: string }>(db, "SELECT deal_id, payload FROM finance_request WHERE deleted_at IS NULL AND status <> 'launched'")) {
      const p = JSON.parse(r.payload) as PackageRequest;
      if (p.mode === "income") asked.set(r.deal_id, (asked.get(r.deal_id) ?? 0) + (p.amountCents ?? 0));
    }
    const wonDays = opts.wonDays ?? 3;
    for (const c of cards.values()) {
      if (c.status !== "won" || c.finance_skip || c.value_cents <= 0 || !c.closed_at) continue;
      const days = daysBetween(new Date(c.closed_at).toLocaleDateString("sv-SE"), today);
      const missing = c.value_cents - (launched.get(c.id) ?? 0) - (asked.get(c.id) ?? 0);
      if (days >= wonDays && missing > 0 && days <= 180)
        out.wonWithoutIncome.push({ cardId: c.id, cardTitle: c.title, client: c.client, valueCents: c.value_cents, missingCents: missing, closedAt: c.closed_at, days });
    }
    out.wonWithoutIncome.sort((a, b) => b.missingCents - a.missingCents);
  }
  return out;
}

/** Linhas do resumo diário (vazio sem nada a avisar). `wa` = negrito do WhatsApp. */
export function financeDigestLines(a: FinanceAlerts, wa: boolean): string[] {
  const b = (t: string) => (wa ? `*${t}*` : t);
  const money = (c: number) => formatCents(c);
  const lines: string[] = [];
  const overdue = a.overdueReceivables.reduce((s, x) => s + x.amountCents, 0);
  if (a.overdueReceivables.length) {
    lines.push(`💰 ${b(`${a.overdueReceivables.length} receita${a.overdueReceivables.length === 1 ? "" : "s"} atrasada${a.overdueReceivables.length === 1 ? "" : "s"} (${money(overdue)})`)}`);
    for (const x of a.overdueReceivables.slice(0, 5)) lines.push(`• ${x.cardTitle}${x.client ? ` - ${x.client}` : ""}: ${money(x.amountCents)}, há ${x.daysLate} dia${x.daysLate === 1 ? "" : "s"}`);
  }
  if (a.dueSoon.length) lines.push(`📅 ${a.dueSoon.length} receita${a.dueSoon.length === 1 ? "" : "s"} vencendo em 7 dias (${money(a.dueSoon.reduce((s, x) => s + x.amountCents, 0))})`);
  if (a.wonWithoutIncome.length) {
    lines.push(`🧾 ${b(`${a.wonWithoutIncome.length} ganho${a.wonWithoutIncome.length === 1 ? "" : "s"} com receita a lançar`)}`);
    for (const x of a.wonWithoutIncome.slice(0, 5)) lines.push(`• ${x.cardTitle}: falta ${money(x.missingCents)}`);
  }
  if (a.overduePayables.count) lines.push(`⚠️ ${a.overduePayables.count} despesa(s) atrasada(s) (${money(a.overduePayables.amountCents)})`);
  return lines.length ? ["Financeiro:", ...lines] : [];
}
