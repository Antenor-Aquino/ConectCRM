// Operações expostas pelo documento offscreen (dono do banco) às telas.
// Cada entrada recebe (db, ctx, params) e devolve dados serializáveis.
import { activePipelineTypes, createPipeline, listPipelines, listStages, updatePipeline, type NewPipeline } from "../db/pipelines";
import type { DbContext } from "../db/repo";
import { many, one, type DatabaseSync } from "../db/sql";

type Handler = (db: DatabaseSync, ctx: DbContext, params: never) => unknown;

export const methods = {
  "system.info": (db: DatabaseSync, ctx: DbContext) => ({
    workspaceId: ctx.workspaceId,
    migrations: many<{ name: string }>(db, "SELECT name FROM _migrations ORDER BY name").map((r) => r.name),
    pendingSync: one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM change_log WHERE synced_at IS NULL")?.n ?? 0,
  }),
  "pipelines.list": (db: DatabaseSync, _ctx: DbContext, p: { includeArchived?: boolean } = {}) => listPipelines(db, p),
  "pipelines.activeTypes": (db: DatabaseSync) => activePipelineTypes(db),
  "pipelines.create": (db: DatabaseSync, ctx: DbContext, p: NewPipeline) => createPipeline(db, ctx, p),
  "pipelines.update": (
    db: DatabaseSync,
    ctx: DbContext,
    p: { id: string; patch: Parameters<typeof updatePipeline>[3] },
  ) => updatePipeline(db, ctx, p.id, p.patch),
  "stages.list": (db: DatabaseSync, _ctx: DbContext, p: { pipelineId: string }) => listStages(db, p.pipelineId),
} satisfies Record<string, Handler>;

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type MethodParams<M extends MethodName> = Parameters<Methods[M]>[2];
export type MethodResult<M extends MethodName> = ReturnType<Methods[M]>;
