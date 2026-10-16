// Edição das etapas de um funil (spec 01, seção 10): nome, cor, ordem,
// probabilidade e prazo; excluir etapa com cartões exige escolher o destino.
import { badgePalette } from "../../../shared/tailadmin/src/tokens";
import { requireText, ValidationError } from "../lib/validate";
import { moveCard } from "./deals";
import { listStages } from "./pipelines";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync, type SqlValue } from "./sql";

export interface StageDraft {
  id?: string;
  name: string;
  color?: string | null;
  probability?: number | null;
  staleDays?: number | null;
}

/** Salva a lista completa de etapas na ordem recebida. Etapas que sumiram da
 * lista são excluídas; se tiverem cartões, `moveTo[etapaRemovida]` diz para
 * qual etapa (da lista) eles vão. */
export function saveStages(
  db: DatabaseSync,
  ctx: DbContext,
  pipelineId: string,
  stages: StageDraft[],
  moveTo: Record<string, string> = {},
): void {
  if (stages.length === 0) throw new ValidationError("O funil precisa de pelo menos uma etapa.");
  withTransaction(db, () => {
    if (!one(db, "SELECT 1 FROM pipeline WHERE id = ? AND deleted_at IS NULL", pipelineId)) throw new ValidationError("Funil não encontrado.");
    const current = listStages(db, pipelineId);
    const ids: string[] = [];
    stages.forEach((s, i) => {
      if (s.id && !current.some((c) => c.id === s.id)) throw new ValidationError("Etapa não encontrada.");
      if (s.color && !(s.color in badgePalette)) throw new ValidationError("Cor de etapa inválida.");
      if (s.probability != null && (!Number.isInteger(s.probability) || s.probability < 0 || s.probability > 100)) {
        throw new ValidationError("Probabilidade deve ser de 0 a 100.");
      }
      if (s.staleDays != null && (!Number.isInteger(s.staleDays) || s.staleDays < 1)) throw new ValidationError("Prazo em dias inválido.");
      const data: Record<string, SqlValue> = {
        name: requireText(s.name, `Informe o nome da etapa ${i + 1}.`),
        color: s.color ?? null,
        position: i,
        probability: s.probability ?? null,
        stale_days: s.staleDays ?? null,
      };
      if (s.id) {
        updateRow(db, ctx, "stage", s.id, data);
        ids.push(s.id);
      } else ids.push(insertRow(db, ctx, "stage", { pipeline_id: pipelineId, ...data }));
    });
    for (const removed of current.filter((c) => !ids.includes(c.id))) {
      const cards = many<{ id: string }>(db, "SELECT id FROM deal WHERE stage_id = ? AND deleted_at IS NULL ORDER BY position", removed.id);
      if (cards.length > 0) {
        const target = moveTo[removed.id];
        if (!target || !ids.includes(target)) {
          throw new ValidationError(`A etapa "${removed.name}" tem cartões: escolha para qual etapa movê-los.`);
        }
        for (const c of cards) moveCard(db, ctx, c.id, { stageId: target });
      }
      softDelete(db, ctx, "stage", removed.id);
    }
  });
}
