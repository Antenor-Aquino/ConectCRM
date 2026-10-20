// Financeiro do cartão (spec 13, Fase 2): o dinheiro mora na Gestão
// Financeira; aqui fica quem é o cliente/fornecedor do cartão (o que vai no
// pedido de lançamento) e a cópia local dos lançamentos lidos de lá, para a
// aba Financeiro funcionar mesmo com a outra extensão fechada.
import type { FinanceItem, LaunchCounterparty } from "../lib/finance/protocol";
import { cardScope } from "./deals";
import type { DbContext } from "./repo";
import { many, one, run, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import type { Viewer } from "./users";

/** Cliente/fornecedor padrão do cartão: a organização; sem ela, o contato principal. */
export function cardCounterparty(db: DatabaseSync, dealId: string): LaunchCounterparty | null {
  const d = one<{ person_id: string | null; organization_id: string | null }>(
    db,
    "SELECT person_id, organization_id FROM deal WHERE id = ? AND deleted_at IS NULL",
    dealId,
  );
  if (!d) return null;
  if (d.organization_id) {
    const o = one<{ id: string; name: string; cnpj: string | null; email: string | null; phone: string | null }>(
      db,
      "SELECT id, name, cnpj, email, phone FROM organization WHERE id = ? AND deleted_at IS NULL",
      d.organization_id,
    );
    if (o) return { crmRef: `organization:${o.id}`, kind: "PJ", name: o.name, document: o.cnpj, email: o.email, phone: o.phone };
  }
  if (d.person_id) {
    const p = one<{ id: string; name: string; cpf: string | null; email: string | null; phone: string | null }>(
      db,
      "SELECT id, name, cpf, email, phone FROM person WHERE id = ? AND deleted_at IS NULL",
      d.person_id,
    );
    if (p) return { crmRef: `person:${p.id}`, kind: "PF", name: p.name, document: p.cpf, email: p.email, phone: p.phone };
  }
  return null;
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
    `SELECT d.id, d.title, d.pipeline_id, p.name AS pipeline_name, d.status, d.value_cents, d.closed_at,
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
    .filter((c) => c.status === "won" && c.value_cents > 0 && !!c.closed_at && toLocalDate(c.closed_at) >= f.start && toLocalDate(c.closed_at) <= f.end)
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
    `SELECT d.id, d.title, d.pipeline_id, p.name AS pipeline_name, d.status, d.value_cents, d.closed_at, NULL AS client
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id
     WHERE d.deleted_at IS NULL${extra}${scope.sql}`,
    id,
    ...scope.params,
  );
}
