// Ponto único de gravação das tabelas de dados (PLANEJAMENTO.md, seção 5.2):
// preenche id/autoria/datas, incrementa `version`, faz exclusão lógica e
// registra cada alteração em change_log (histórico agora, fila de
// sincronização no futuro). Nenhum módulo deve dar INSERT/UPDATE direto
// nessas tabelas.
import { newId, nowIso } from "../lib/ids";
import { many, one, run, withTransaction, type DatabaseSync, type SqlValue } from "./sql";

export interface DbContext {
  workspaceId: string;
  /** Usuário que faz a alteração (null = sistema, ex.: dados iniciais). */
  userId: string | null;
}

export type Row = Record<string, SqlValue>;

export const DATA_TABLES = [
  "app_user",
  "team",
  "team_member",
  "pipeline",
  "stage",
  "loss_reason",
  "person",
  "organization",
  "person_organization",
  "deal",
  "deal_stage_history",
  "deal_participant",
  "product_category",
  "product",
  "deal_item",
  "activity_type",
  "activity_series",
  "activity",
  "activity_reminder",
  "activity_contact_message",
  "note",
  "attachment",
  "whatsapp_capture",
  "whatsapp_send",
  "record_origin",
  "tag",
  "entity_tag",
  "custom_field",
  "custom_field_group",
  "custom_field_option",
  "custom_field_pipeline",
  "custom_field_value",
  "saved_filter",
  "document_type",
  "document_folder",
  "file_blob",
  "document",
  "document_version",
  "document_link",
  "external_ref",
] as const;
export type DataTable = (typeof DATA_TABLES)[number];

const SYSTEM_COLUMNS = new Set([
  "id",
  "workspace_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "deleted_at",
  "version",
]);

function assertTable(table: string): asserts table is DataTable {
  if (!(DATA_TABLES as readonly string[]).includes(table)) throw new Error(`Tabela desconhecida: ${table}`);
}

function assertColumn(col: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(col)) throw new Error(`Coluna inválida: ${col}`);
  if (SYSTEM_COLUMNS.has(col)) throw new Error(`Coluna de sistema não pode ser gravada diretamente: ${col}`);
}

// Blobs (anexos) não vão para o change_log - só o tamanho.
function logValue(v: SqlValue | undefined): unknown {
  if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`;
  return v ?? null;
}

function writeLog(
  db: DatabaseSync,
  ctx: DbContext,
  table: DataTable,
  rowId: string,
  op: "insert" | "update" | "delete" | "restore",
  changes: Record<string, [unknown, unknown]>,
  version: number,
  at: string,
): void {
  run(
    db,
    `INSERT INTO change_log (id, workspace_id, table_name, row_id, op, changes, row_version, user_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    ctx.workspaceId,
    table,
    rowId,
    op,
    JSON.stringify(changes),
    version,
    ctx.userId,
    at,
  );
}

export function insertRow(db: DatabaseSync, ctx: DbContext, table: DataTable, data: Row, id: string = newId()): string {
  assertTable(table);
  const cols = Object.keys(data);
  cols.forEach(assertColumn);
  const at = nowIso();
  const allCols = ["id", "workspace_id", ...cols, "created_at", "created_by", "updated_at", "updated_by", "version"];
  const values: SqlValue[] = [id, ctx.workspaceId, ...cols.map((c) => data[c] ?? null), at, ctx.userId, at, ctx.userId, 1];
  withTransaction(db, () => {
    run(db, `INSERT INTO ${table} (${allCols.join(", ")}) VALUES (${allCols.map(() => "?").join(", ")})`, ...values);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const c of cols) changes[c] = [null, logValue(data[c])];
    writeLog(db, ctx, table, id, "insert", changes, 1, at);
  });
  return id;
}

/** Atualiza só os campos que mudaram; devolve false se nada mudou.
 * `expectedVersion` (opcional) recusa a gravação se o registro mudou desde
 * que foi lido - mesma checagem que a sincronização vai usar. */
export function updateRow(
  db: DatabaseSync,
  ctx: DbContext,
  table: DataTable,
  id: string,
  data: Row,
  expectedVersion?: number,
): boolean {
  assertTable(table);
  const cols = Object.keys(data);
  cols.forEach(assertColumn);
  return withTransaction(db, () => {
    const current = getRow(db, table, id, { includeDeleted: true });
    if (!current) throw new Error(`Registro não encontrado: ${table}/${id}`);
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new Error("Este registro foi alterado em outro lugar. Recarregue e tente de novo.");
    }
    const changed = cols.filter((c) => !sameValue(current[c], data[c] ?? null));
    if (changed.length === 0) return false;
    const at = nowIso();
    const version = (current.version as number) + 1;
    run(
      db,
      `UPDATE ${table} SET ${changed.map((c) => `${c} = ?`).join(", ")}, updated_at = ?, updated_by = ?, version = ?
       WHERE id = ?`,
      ...changed.map((c) => data[c] ?? null),
      at,
      ctx.userId,
      version,
      id,
    );
    const changes: Record<string, [unknown, unknown]> = {};
    for (const c of changed) changes[c] = [logValue(current[c]), logValue(data[c])];
    writeLog(db, ctx, table, id, "update", changes, version, at);
    return true;
  });
}

export function softDelete(db: DatabaseSync, ctx: DbContext, table: DataTable, id: string): void {
  setDeleted(db, ctx, table, id, true);
}

export function restore(db: DatabaseSync, ctx: DbContext, table: DataTable, id: string): void {
  setDeleted(db, ctx, table, id, false);
}

function setDeleted(db: DatabaseSync, ctx: DbContext, table: DataTable, id: string, deleted: boolean): void {
  assertTable(table);
  withTransaction(db, () => {
    const current = getRow(db, table, id, { includeDeleted: true });
    if (!current) throw new Error(`Registro não encontrado: ${table}/${id}`);
    if ((current.deleted_at !== null) === deleted) return;
    const at = nowIso();
    const version = (current.version as number) + 1;
    const deletedAt = deleted ? at : null;
    run(db, `UPDATE ${table} SET deleted_at = ?, updated_at = ?, updated_by = ?, version = ? WHERE id = ?`, deletedAt, at, ctx.userId, version, id);
    writeLog(db, ctx, table, id, deleted ? "delete" : "restore", { deleted_at: [current.deleted_at, deletedAt] }, version, at);
  });
}

export function getRow(db: DatabaseSync, table: DataTable, id: string, opts: { includeDeleted?: boolean } = {}): Row | undefined {
  assertTable(table);
  const extra = opts.includeDeleted ? "" : " AND deleted_at IS NULL";
  return one<Row>(db, `SELECT * FROM ${table} WHERE id = ?${extra}`, id);
}

export function rowHistory(db: DatabaseSync, table: DataTable, id: string) {
  return many<{ op: string; changes: string; user_id: string | null; at: string; row_version: number }>(
    db,
    "SELECT op, changes, user_id, at, row_version FROM change_log WHERE table_name = ? AND row_id = ? ORDER BY at, row_version",
    table,
    id,
  );
}

function sameValue(a: SqlValue | undefined, b: SqlValue): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
  }
  return (a ?? null) === b;
}
