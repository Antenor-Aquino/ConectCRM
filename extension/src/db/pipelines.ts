import { isCardFieldKey, MAX_CARD_FIELDS } from "../lib/cardFields";
import { PIPELINE_TYPE_ORDER } from "../lib/cardTypes";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { moveToTrash, type TrashNotice } from "./trash";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export type PipelineType = "comercial" | "operacional" | "projeto";
export type DealKind = "deal" | "ticket" | "project";

/** Tipo do funil → tipo do cartão (spec 01, seção 2). */
export const KIND_BY_PIPELINE_TYPE: Record<PipelineType, DealKind> = {
  comercial: "deal",
  operacional: "ticket",
  projeto: "project",
};

export interface Pipeline {
  id: string;
  name: string;
  type: PipelineType;
  icon: string | null;
  color: string | null;
  position: number;
  archived_at: string | null;
  /** JSON com os campos do cartão (lib/cardFields.ts); null = padrão. */
  card_fields: string | null;
  version: number;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  color: string | null;
  position: number;
  probability: number | null;
  stale_days: number | null;
  version: number;
}

export interface NewPipeline {
  name: string;
  type: PipelineType;
  icon?: string | null;
  color?: string | null;
  stages: { name: string; color?: string | null; probability?: number | null; staleDays?: number | null }[];
}

/** Por categoria (comercial, projeto, operacional) e depois por nome. */
export function listPipelines(db: DatabaseSync, opts: { includeArchived?: boolean } = {}): Pipeline[] {
  const rows = many<Pipeline>(
    db,
    `SELECT id, name, type, icon, color, position, archived_at, card_fields, version FROM pipeline
     WHERE deleted_at IS NULL ${opts.includeArchived ? "" : "AND archived_at IS NULL"}`,
  );
  return rows.sort((a, b) => PIPELINE_TYPE_ORDER.indexOf(a.type) - PIPELINE_TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

export function listStages(db: DatabaseSync, pipelineId: string): Stage[] {
  return many<Stage>(
    db,
    `SELECT id, pipeline_id, name, color, position, probability, stale_days, version FROM stage
     WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position`,
    pipelineId,
  );
}

/** Tipos com pelo menos um funil ativo - controla as opções do botão "+" (spec 01, seção 3). */
export function activePipelineTypes(db: DatabaseSync): PipelineType[] {
  return many<{ type: PipelineType }>(
    db,
    "SELECT DISTINCT type FROM pipeline WHERE deleted_at IS NULL AND archived_at IS NULL",
  ).map((r) => r.type);
}

export function createPipeline(db: DatabaseSync, ctx: DbContext, input: NewPipeline): string {
  const name = input.name.trim();
  if (!name) throw new Error("Informe o nome do funil.");
  if (input.stages.length === 0) throw new Error("O funil precisa de pelo menos uma etapa.");
  return withTransaction(db, () => {
    const last = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM pipeline WHERE deleted_at IS NULL");
    const pipelineId = insertRow(db, ctx, "pipeline", {
      name,
      type: input.type,
      icon: input.icon ?? null,
      color: input.color ?? null,
      position: (last?.p ?? -1) + 1,
    });
    input.stages.forEach((s, i) => {
      const stageName = s.name.trim();
      if (!stageName) throw new Error(`Informe o nome da etapa ${i + 1}.`);
      insertRow(db, ctx, "stage", {
        pipeline_id: pipelineId,
        name: stageName,
        color: s.color ?? null,
        position: i,
        probability: s.probability ?? null,
        stale_days: s.staleDays ?? null,
      });
    });
    return pipelineId;
  });
}

/** O tipo não é editável depois de criado (spec 01, P5). */
export function updatePipeline(
  db: DatabaseSync,
  ctx: DbContext,
  id: string,
  patch: { name?: string; icon?: string | null; color?: string | null; archived?: boolean; cardFields?: string[] | null },
): void {
  const data: Record<string, string | null> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Informe o nome do funil.");
    data.name = name;
  }
  if (patch.icon !== undefined) data.icon = patch.icon;
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.archived !== undefined) data.archived_at = patch.archived ? new Date().toISOString() : null;
  if (patch.cardFields !== undefined) {
    if (patch.cardFields === null) data.card_fields = null;
    else {
      const bad = patch.cardFields.find((k) => !isCardFieldKey(k));
      if (bad) throw new Error(`Campo de cartão inválido: ${bad}`);
      if (patch.cardFields.length > MAX_CARD_FIELDS) throw new Error(`No máximo ${MAX_CARD_FIELDS} campos no cartão.`);
      data.card_fields = JSON.stringify([...new Set(patch.cardFields)]);
    }
  }
  updateRow(db, ctx, "pipeline", id, data);
}

export function deletePipeline(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  const open = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM deal WHERE pipeline_id = ? AND deleted_at IS NULL", id);
  if ((open?.n ?? 0) > 0) throw new Error("Este funil tem cartões. Mova-os ou arquive o funil.");
  return moveToTrash(db, ctx, "pipeline", id, () => {
    for (const s of listStages(db, id)) softDelete(db, ctx, "stage", s.id);
    softDelete(db, ctx, "pipeline", id);
  });
}
