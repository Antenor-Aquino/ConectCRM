// Financeiro do cartão (spec 13, Fase 2): o dinheiro mora na Gestão
// Financeira; aqui fica quem é o cliente/fornecedor do cartão (o que vai no
// pedido de lançamento) e a cópia local dos lançamentos lidos de lá, para a
// aba Financeiro funcionar mesmo com a outra extensão fechada.
import type { FinanceItem, LaunchCounterparty } from "../lib/finance/protocol";
import type { DbContext } from "./repo";
import { many, one, run, withTransaction, type DatabaseSync } from "./sql";

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
