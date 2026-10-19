// Ações em lote nos cartões selecionados no quadro ou na lista (spec 01,
// seção 10.1.3). Cada cartão é tratado na sua transação: um erro (sem
// permissão, campo obrigatório...) não impede os outros, e o resumo diz qual
// falhou e por quê.
import { errorText } from "../lib/errors";
import type { ReminderRule } from "../lib/notify/settings";
import { ValidationError } from "../lib/validate";
import { createActivity } from "./activities";
import { addCardContact } from "./cardContacts";
import { setCustomValues, type CustomValue } from "./customFields";
import {
  assertCanAssign,
  assertCardAccess,
  changeCardPipeline,
  deleteCard,
  getCardRow,
  matchingStageId,
  moveCard,
  setCardStatus,
  updateCard,
  type CardInput,
  type DealStatus,
} from "./deals";
import { updateRow, type DbContext } from "./repo";
import { one, withTransaction, type DatabaseSync } from "./sql";
import { getEntityTags, setEntityTags } from "./tags";
import type { Viewer } from "./users";

export type BulkAction =
  /** Etapa do mesmo funil (ou de outro funil do mesmo tipo). */
  | { type: "moveStage"; stageId: string }
  /** Outro funil (de qualquer categoria): etapa de mesmo nome quando existe, senão `fallbackStageId`. */
  | { type: "changePipeline"; pipelineId: string; fallbackStageId: string; matchByName?: boolean }
  | { type: "owner"; ownerId: string | null }
  | { type: "addTags"; tagIds: string[] }
  | { type: "removeTags"; tagIds: string[] }
  | { type: "status"; status: DealStatus; lossReasonId?: string | null; lossNote?: string | null }
  | { type: "archive" }
  | { type: "unarchive" }
  | { type: "delete" }
  /** Atualizar um campo: padrão (previsão, SLA, início, prazo, origem) ou personalizado. */
  | { type: "setField"; field: "expectedCloseAt" | "slaAt" | "startAt" | "dueAt" | "origin"; value: string | null }
  | { type: "setCustom"; fieldId: string; value: CustomValue }
  | { type: "addContact"; personId: string }
  /** Mesma atividade em cada cartão (ex.: "Ligar para retomar" amanhã às 9h). */
  | { type: "activity"; typeId?: string; title: string; dueAt: string; endAt?: string | null; ownerFromCard?: boolean; reminders?: ReminderRule[] };

export interface BulkResult {
  done: number;
  errors: { id: string; title: string; message: string }[];
}

export function bulkCards(db: DatabaseSync, ctx: DbContext, viewer: Viewer | null, ids: string[], action: BulkAction): BulkResult {
  const out: BulkResult = { done: 0, errors: [] };
  if (action.type === "owner") assertCanAssign(db, viewer, action.ownerId);
  for (const id of [...new Set(ids)]) {
    const card = getCardRow(db, id);
    try {
      if (!card) throw new ValidationError("Cartão não encontrado.");
      assertCardAccess(db, viewer, id);
      withTransaction(db, () => apply(db, ctx, viewer, id, action));
      out.done++;
    } catch (e) {
      out.errors.push({ id, title: card?.title ?? id, message: errorText(e) });
    }
  }
  return out;
}

function apply(db: DatabaseSync, ctx: DbContext, viewer: Viewer | null, id: string, a: BulkAction): void {
  const card = getCardRow(db, id)!;
  switch (a.type) {
    case "moveStage":
      if (card.stage_id !== a.stageId) moveCard(db, ctx, id, { stageId: a.stageId });
      return;
    case "changePipeline": {
      if (card.pipeline_id === a.pipelineId) {
        if (card.stage_id !== a.fallbackStageId && a.matchByName === false) moveCard(db, ctx, id, { stageId: a.fallbackStageId });
        return;
      }
      const match = a.matchByName !== false ? matchingStageId(db, card.stage_id, a.pipelineId) : null;
      changeCardPipeline(db, ctx, id, { pipelineId: a.pipelineId, stageId: match ?? a.fallbackStageId });
      return;
    }
    case "owner":
      updateCard(db, ctx, id, { ownerId: a.ownerId });
      return;
    case "addTags":
    case "removeTags": {
      const current = getEntityTags(db, id).map((t) => t.id);
      const next = a.type === "addTags" ? [...new Set([...current, ...a.tagIds])] : current.filter((t) => !a.tagIds.includes(t));
      if (next.length !== current.length || next.some((t, i) => t !== current[i])) setEntityTags(db, ctx, card.kind, id, next);
      return;
    }
    case "status":
      if (card.status !== a.status) setCardStatus(db, ctx, id, a);
      return;
    case "archive":
    case "unarchive":
      if (!!card.archived_at !== (a.type === "archive"))
        updateRow(db, ctx, "deal", id, { archived_at: a.type === "archive" ? new Date().toISOString() : null });
      return;
    case "delete":
      deleteCard(db, ctx, id);
      return;
    case "setField": {
      // Campo que não existe no tipo do cartão (SLA num negócio...) é ignorado.
      const kindOk =
        a.field === "origin" ||
        (a.field === "expectedCloseAt" && card.kind === "deal") ||
        (a.field === "slaAt" && card.kind === "ticket") ||
        ((a.field === "startAt" || a.field === "dueAt") && card.kind === "project");
      if (!kindOk) throw new ValidationError("Este campo não existe neste tipo de cartão.");
      updateCard(db, ctx, id, { [a.field]: a.value } as Partial<CardInput>);
      return;
    }
    case "setCustom":
      setCustomValues(db, ctx, card.kind, id, { [a.fieldId]: a.value }, { pipelineId: card.pipeline_id });
      return;
    case "addContact":
      addCardContact(db, ctx, id, a.personId);
      return;
    case "activity": {
      const ownerId = a.ownerFromCard && card.owner_id ? card.owner_id : (viewer?.id ?? ctx.userId);
      createActivity(db, ctx, {
        typeId: a.typeId,
        title: a.title,
        dueAt: a.dueAt,
        endAt: a.endAt ?? null,
        ownerId,
        dealId: id,
        personId: card.person_id,
        organizationId: card.organization_id,
        ...(a.reminders ? { reminders: a.reminders } : {}),
      });
      return;
    }
  }
}

/** Arquivar/desarquivar um cartão (detalhe do cartão). */
export function setCardArchived(db: DatabaseSync, ctx: DbContext, id: string, archived: boolean): void {
  const card = one<{ archived_at: string | null }>(db, "SELECT archived_at FROM deal WHERE id = ? AND deleted_at IS NULL", id);
  if (!card) throw new ValidationError("Cartão não encontrado.");
  if (!!card.archived_at !== archived) updateRow(db, ctx, "deal", id, { archived_at: archived ? new Date().toISOString() : null });
}
