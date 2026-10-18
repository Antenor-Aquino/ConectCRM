// Quantidades das abas do detalhe do cartão: Histórico, Notas, Atividades
// (e quantas estão atrasadas) e Documentos.
import { OVERDUE_COND, overdueParams } from "../lib/taskTiming";
import { cardHistory } from "./cardHistory";
import { one, type DatabaseSync } from "./sql";

export interface CardCounts {
  history: number;
  notes: number;
  activities: number;
  activitiesOverdue: number;
  documents: number;
}

export function cardCounts(db: DatabaseSync, cardId: string, now = new Date()): CardCounts {
  const n = (sql: string, ...params: (string | number)[]) => one<{ n: number }>(db, sql, ...params)?.n ?? 0;
  return {
    history: cardHistory(db, cardId).length,
    notes: n("SELECT COUNT(*) AS n FROM note WHERE entity_type = 'deal' AND entity_id = ? AND deleted_at IS NULL", cardId),
    activities: n("SELECT COUNT(*) AS n FROM activity WHERE deal_id = ? AND deleted_at IS NULL", cardId),
    activitiesOverdue: n(`SELECT COUNT(*) AS n FROM activity a WHERE a.deal_id = ? AND a.deleted_at IS NULL AND a.done = 0 AND ${OVERDUE_COND}`, cardId, ...overdueParams(now)),
    documents: n(
      `SELECT COUNT(DISTINCT l.document_id) AS n FROM document_link l JOIN document d ON d.id = l.document_id
       WHERE l.entity_type = 'deal' AND l.entity_id = ? AND l.deleted_at IS NULL AND d.deleted_at IS NULL AND d.purged_at IS NULL`,
      cardId,
    ),
  };
}
