// Cartão com financeiro não se perde (spec 13): o lançamento na Gestão
// Financeira aponta para o cartão pelo id (origin_ref). Excluir o cartão — e,
// depois do prazo da lixeira, apagá-lo de vez — deixaria o lançamento sem
// referência. Por isso o cartão só pode ser excluído sem lançamentos; com
// eles, o caminho é arquivar (sai do quadro, continua no banco e nos relatórios).
import { ValidationError } from "../lib/validate";
import { many, one, type DatabaseSync } from "./sql";

export interface CardFinanceLock {
  /** Lançamentos na cópia local (lida da Gestão Financeira). */
  entries: number;
  /** Pedidos do modo pacote que ainda vão virar lançamento (pendentes ou exportados). */
  requests: number;
  incomeCents: number;
  expenseCents: number;
  /** A Gestão Financeira já foi lida para este cartão (a cópia local vale como resposta). */
  synced: boolean;
}

export const hasFinance = (l: CardFinanceLock): boolean => l.entries + l.requests > 0;

export function cardFinanceLock(db: DatabaseSync, dealId: string): CardFinanceLock {
  const e = one<{ n: number; income: number; expense: number }>(
    db,
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents END), 0) AS income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents END), 0) AS expense
     FROM finance_entry WHERE deal_id = ?`,
    dealId,
  );
  // "launched" já está na cópia local como lançamento; contar de novo travaria o cartão para sempre
  // mesmo depois de o lançamento ser excluído na Gestão Financeira.
  const r = one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM finance_request WHERE deal_id = ? AND deleted_at IS NULL AND status IN ('pending', 'exported')",
    dealId,
  );
  const s = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM finance_sync WHERE deal_id = ?", dealId);
  return {
    entries: e?.n ?? 0,
    requests: r?.n ?? 0,
    incomeCents: e?.income ?? 0,
    expenseCents: e?.expense ?? 0,
    synced: (s?.n ?? 0) > 0,
  };
}

export function cardFinanceLocks(db: DatabaseSync, ids: string[]): Record<string, CardFinanceLock> {
  return Object.fromEntries([...new Set(ids)].map((id) => [id, cardFinanceLock(db, id)]));
}

/** Quais dos cartões já têm lançamento ou pedido (para pular na exclusão em lote e na limpeza da lixeira). */
export function cardsWithFinance(db: DatabaseSync, ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => hasFinance(cardFinanceLock(db, id)));
}

export function financeBlockMessage(lock: CardFinanceLock, noun = "cartão"): string {
  const parts: string[] = [];
  if (lock.entries) parts.push(`${lock.entries} lançamento${lock.entries === 1 ? "" : "s"} na Gestão Financeira`);
  if (lock.requests) parts.push(`${lock.requests} pedido${lock.requests === 1 ? "" : "s"} de lançamento aguardando a Gestão Financeira`);
  return (
    `Este ${noun} tem ${parts.join(" e ")} e não pode ser excluído, para não perder o vínculo com o financeiro. ` +
    "Arquive-o (sai do quadro, mas continua no banco e nos relatórios) ou, na Gestão Financeira, estorne os lançamentos pagos e exclua todos."
  );
}

/** Barreira única de exclusão: individual, em lote, Copiloto. */
export function assertNoFinance(db: DatabaseSync, dealId: string): void {
  const lock = cardFinanceLock(db, dealId);
  if (!hasFinance(lock)) return;
  const kind = one<{ kind: string }>(db, "SELECT kind FROM deal WHERE id = ?", dealId)?.kind;
  throw new ValidationError(financeBlockMessage(lock, kind === "ticket" ? "ticket" : kind === "project" ? "projeto" : "negócio"));
}

/** Cartões excluídos antes desta regra que ainda têm financeiro (a lixeira não os apaga). */
export function trashedCardsWithFinance(db: DatabaseSync): Set<string> {
  const ids = many<{ record_id: string }>(db, "SELECT record_id FROM trash_item WHERE entity = 'deal'").map((r) => r.record_id);
  return new Set(cardsWithFinance(db, ids));
}
