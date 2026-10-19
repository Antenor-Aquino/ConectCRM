// Lixeira (spec 11). Toda exclusão passa por `moveToTrash`: o que a exclusão
// alterou no banco (o registro e o que foi junto) fica guardado no item, para
// restaurar tudo de uma vez. Passado o prazo (padrão 30 dias, configurável),
// o item é excluído definitivamente: as linhas saem do banco, com o histórico.
import { newId, nowIso } from "../lib/ids";
import { formatDate } from "../lib/format";
import { ValidationError } from "../lib/validate";
import type { OrphanBlob } from "./documents";
import { DATA_TABLES, restore, softDelete, updateRow, type DataTable, type DbContext } from "./repo";
import { many, one, run, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import type { Viewer } from "./users";

export const DEFAULT_RETENTION_DAYS = 30;
const RETENTION_KEY = "trash.retention_days";

/** O que a tela mostra depois de excluir ("... enviado para a lixeira ..."). */
export interface TrashNotice {
  __trash: true;
  /** Itens criados (para o botão Restaurar). */
  ids: string[];
  /** "Negócio “Escola Alfa”" ou "3 cartões". */
  label: string;
  days: number;
}

export interface TrashItem {
  id: string;
  entity: string;
  record_id: string;
  title: string;
  detail: string | null;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  /** Data em que será excluído definitivamente. */
  expires_at: string;
  /** Quantos registros foram junto (atividades e notas do cartão...). */
  related: number;
}

interface LoggedChange {
  table: DataTable;
  row_id: string;
  op: "insert" | "update" | "delete" | "restore";
  changes: Record<string, [unknown, unknown]>;
}

export const ENTITY_LABEL: Record<string, string> = {
  deal: "Cartão",
  person: "Contato",
  organization: "Organização",
  activity: "Atividade",
  note: "Nota",
  product: "Produto",
  product_category: "Categoria de produto",
  tag: "Tag",
  pipeline: "Funil",
  stage: "Etapa",
  team: "Equipe",
  custom_field: "Campo personalizado",
  custom_field_group: "Categoria de campos",
  document_type: "Tipo de documento",
  document: "Documento",
};
const KIND_LABEL: Record<string, string> = { deal: "Negócio", ticket: "Ticket", project: "Projeto" };

// ---------- Prazo ----------

export function retentionDays(db: DatabaseSync): number {
  const r = one<{ value: string }>(db, "SELECT value FROM setting WHERE key = ?", RETENTION_KEY);
  const n = r ? Number(JSON.parse(r.value)) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_RETENTION_DAYS;
}

export function setRetentionDays(db: DatabaseSync, ctx: DbContext, days: number): void {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new ValidationError("O prazo da lixeira deve ser de 1 a 365 dias.");
  run(
    db,
    `INSERT INTO setting (workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ctx.workspaceId,
    RETENTION_KEY,
    JSON.stringify(days),
    nowIso(),
  );
}

const expiresAt = (deletedAt: string, days: number) => new Date(new Date(deletedAt).getTime() + days * 86400_000).toISOString();

// ---------- Enviar para a lixeira ----------

/** Nome e detalhe do registro, para a lista da lixeira. */
export function describe(db: DatabaseSync, entity: string, id: string): { title: string; detail: string | null } {
  const r = (sql: string) => one<{ title: string | null; detail: string | null }>(db, sql, id);
  let row: { title: string | null; detail: string | null } | undefined;
  switch (entity) {
    case "deal": {
      const d = one<{ title: string; kind: string; pipeline: string | null }>(
        db,
        "SELECT d.title, d.kind, p.name AS pipeline FROM deal d LEFT JOIN pipeline p ON p.id = d.pipeline_id WHERE d.id = ?",
        id,
      );
      return { title: d?.title ?? "Cartão", detail: d ? `${KIND_LABEL[d.kind] ?? "Cartão"}${d.pipeline ? ` · Funil ${d.pipeline}` : ""}` : null };
    }
    case "activity":
      row = r(`SELECT a.title, t.name || ' · ' || a.due_at AS detail FROM activity a LEFT JOIN activity_type t ON t.id = a.type_id WHERE a.id = ?`);
      if (row?.detail) {
        const [type, due] = row.detail.split(" · ");
        row.detail = `${type} · ${formatDate(due)}`;
      }
      break;
    case "note": {
      const n = one<{ body: string; entity_type: string; entity_id: string }>(db, "SELECT body, entity_type, entity_id FROM note WHERE id = ?", id);
      if (!n) break;
      const text = n.body
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const owner = describe(db, n.entity_type, n.entity_id).title;
      return {
        title: text.length > 80 ? `${text.slice(0, 80)}…` : text || "Nota",
        detail: `Nota de ${ENTITY_LABEL[n.entity_type]?.toLowerCase() ?? ""} “${owner}”`,
      };
    }
    case "stage":
      row = r("SELECT s.name AS title, 'Funil ' || p.name AS detail FROM stage s LEFT JOIN pipeline p ON p.id = s.pipeline_id WHERE s.id = ?");
      break;
    case "person":
      row = r("SELECT name AS title, COALESCE(email, phone) AS detail FROM person WHERE id = ?");
      break;
    case "organization":
      row = r("SELECT name AS title, cnpj AS detail FROM organization WHERE id = ?");
      break;
    case "custom_field":
      row = r("SELECT name AS title, entity AS detail FROM custom_field WHERE id = ?");
      if (row?.detail)
        row.detail = `Campo de ${({ deal: "cartão", person: "contato", organization: "organização", activity: "atividade" } as Record<string, string>)[row.detail] ?? row.detail}`;
      break;
    case "custom_field_group":
    case "product":
    case "product_category":
    case "tag":
    case "pipeline":
    case "team":
    case "document_type":
    case "document":
      row = r(`SELECT name AS title, NULL AS detail FROM ${entity} WHERE id = ?`);
      break;
  }
  return { title: row?.title || ENTITY_LABEL[entity] || "Registro", detail: row?.detail ?? null };
}

/**
 * Executa a exclusão (`fn`) e guarda o que ela alterou num item da lixeira.
 * `fn` deve só marcar como excluído (softDelete) e desfazer vínculos.
 */
export function moveToTrash(db: DatabaseSync, ctx: DbContext, entity: DataTable, recordId: string, fn: () => void): TrashNotice {
  return withTransaction(db, () => {
    const { title, detail } = describe(db, entity, recordId);
    const before = one<{ n: number }>(db, "SELECT COALESCE(MAX(rowid), 0) AS n FROM change_log")!.n;
    fn();
    const log = many<{ table_name: string; row_id: string; op: string; changes: string }>(
      db,
      "SELECT table_name, row_id, op, changes FROM change_log WHERE rowid > ? ORDER BY rowid",
      before,
    );
    const id = newId();
    run(
      db,
      `INSERT INTO trash_item (id, workspace_id, entity, record_id, title, detail, changes, deleted_at, deleted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ctx.workspaceId,
      entity,
      recordId,
      title,
      detail,
      JSON.stringify(log.map((l) => ({ table: l.table_name, row_id: l.row_id, op: l.op, changes: JSON.parse(l.changes) }))),
      nowIso(),
      ctx.userId,
    );
    const label = entity === "deal" ? `${detail?.split(" · ")[0] ?? "Cartão"} “${title}”` : `${ENTITY_LABEL[entity] ?? "Registro"} “${title}”`;
    return { __trash: true, ids: [id], label, days: retentionDays(db) };
  });
}

/** Junta vários avisos (ex.: exclusão em lote). */
export function mergeNotices(notices: TrashNotice[], plural: string): TrashNotice | undefined {
  if (!notices.length) return undefined;
  if (notices.length === 1) return notices[0];
  return { __trash: true, ids: notices.flatMap((n) => n.ids), label: `${notices.length} ${plural}`, days: notices[0]!.days };
}

// ---------- Listar ----------

/** O registro principal ainda está excluído? (pode ter sido restaurado por outro caminho, ex.: GED) */
function stillTrashed(db: DatabaseSync, entity: string, id: string): boolean {
  if (!(DATA_TABLES as readonly string[]).includes(entity)) return false;
  const extra = entity === "document" ? " AND purged_at IS NULL" : "";
  return !!one(db, `SELECT 1 FROM ${entity} WHERE id = ? AND deleted_at IS NOT NULL${extra}`, id);
}

/** Itens visíveis: o administrador vê todos; os demais, o que eles mesmos excluíram. */
export function listTrash(db: DatabaseSync, viewer: Viewer | null, filter: { entity?: string; search?: string } = {}): TrashItem[] {
  const days = retentionDays(db);
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (viewer && viewer.role !== "admin") {
    where.push("t.deleted_by = ?");
    params.push(viewer.id);
  }
  if (filter.entity) {
    where.push("t.entity = ?");
    params.push(filter.entity);
  }
  const rows = many<Omit<TrashItem, "expires_at" | "related"> & { changes: string }>(
    db,
    `SELECT t.id, t.entity, t.record_id, t.title, t.detail, t.deleted_at, t.deleted_by, u.name AS deleted_by_name, t.changes
     FROM trash_item t LEFT JOIN app_user u ON u.id = t.deleted_by
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.deleted_at DESC`,
    ...params,
  );
  const q = filter.search?.trim().toLowerCase();
  const out: TrashItem[] = [];
  for (const { changes, ...r } of rows) {
    if (!stillTrashed(db, r.entity, r.record_id)) {
      run(db, "DELETE FROM trash_item WHERE id = ?", r.id);
      continue;
    }
    if (q && !`${r.title} ${r.detail ?? ""}`.toLowerCase().includes(q)) continue;
    const list = JSON.parse(changes) as LoggedChange[];
    const related = new Set(list.filter((c) => c.op === "delete" && c.row_id !== r.record_id && RELATED_TABLES.has(c.table)).map((c) => c.row_id)).size;
    out.push({ ...r, expires_at: expiresAt(r.deleted_at, days), related });
  }
  return out;
}

/** Registros que contam como "foram junto" na lista (o resto são vínculos). */
const RELATED_TABLES = new Set<string>(["activity", "note", "stage"]);

export function trashCount(db: DatabaseSync, viewer: Viewer | null): number {
  return listTrash(db, viewer).length;
}

function assertTrashAccess(db: DatabaseSync, viewer: Viewer | null, id: string): { entity: string; record_id: string; changes: string; title: string } {
  const item = one<{ entity: string; record_id: string; changes: string; title: string; deleted_by: string | null }>(
    db,
    "SELECT entity, record_id, changes, title, deleted_by FROM trash_item WHERE id = ?",
    id,
  );
  if (!item) throw new ValidationError("Item não encontrado na lixeira (pode já ter sido restaurado ou excluído).");
  if (viewer && viewer.role !== "admin" && item.deleted_by !== viewer.id) throw new ValidationError("Você só pode restaurar o que você mesmo excluiu.");
  return item;
}

// ---------- Restaurar ----------

interface FkRef {
  table: DataTable;
  column: string;
  parent: string;
  notNull: boolean;
}

const fkCache = new WeakMap<DatabaseSync, FkRef[]>();
/** Chaves estrangeiras de todas as tabelas de dados (lidas do próprio banco). */
function foreignKeys(db: DatabaseSync): FkRef[] {
  let refs = fkCache.get(db);
  if (refs) return refs;
  refs = [];
  for (const table of DATA_TABLES) {
    const cols = new Map(many<{ name: string; notnull: number }>(db, `PRAGMA table_info(${table})`).map((c) => [c.name, !!c.notnull]));
    for (const fk of many<{ table: string; from: string }>(db, `PRAGMA foreign_key_list(${table})`)) {
      if (fk.table === "workspace" || fk.table === "app_user") continue;
      refs.push({ table, column: fk.from, parent: fk.table, notNull: cols.get(fk.from) ?? false });
    }
  }
  fkCache.set(db, refs);
  return refs;
}

function friendlySqlError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/UNIQUE constraint/i.test(msg))
    return new ValidationError("Já existe um registro ativo igual (ex.: mesmo nome, e-mail ou CNPJ). Renomeie ou exclua o outro antes de restaurar.");
  return e instanceof Error ? e : new Error(msg);
}

/** Restaura um item: desfaz, de trás para frente, o que a exclusão alterou. */
export function restoreTrashItem(db: DatabaseSync, ctx: DbContext, viewer: Viewer | null, id: string): void {
  const item = assertTrashAccess(db, viewer, id);
  const changes = JSON.parse(item.changes) as LoggedChange[];
  withTransaction(db, () => {
    try {
      for (const c of [...changes].reverse()) {
        if (!(DATA_TABLES as readonly string[]).includes(c.table)) continue;
        const row = one<{ deleted_at: string | null }>(db, `SELECT deleted_at FROM ${c.table} WHERE id = ?`, c.row_id);
        if (!row) continue; // já excluído definitivamente por outro caminho
        if (c.op === "delete" && row.deleted_at) restore(db, ctx, c.table, c.row_id);
        else if ((c.op === "insert" || c.op === "restore") && !row.deleted_at) softDelete(db, ctx, c.table, c.row_id);
        else if (c.op === "update") {
          const old = Object.fromEntries(Object.entries(c.changes).map(([k, v]) => [k, v[0] as SqlValue]));
          if (Object.keys(old).length) updateRow(db, ctx, c.table, c.row_id, old);
        }
      }
    } catch (e) {
      throw friendlySqlError(e);
    }
    // O que voltou precisa do "pai" ativo (ex.: cartão precisa do funil e da etapa).
    const refs = foreignKeys(db).filter((f) => f.notNull);
    for (const c of changes) {
      if (c.op !== "delete") continue;
      for (const f of refs.filter((r) => r.table === c.table)) {
        const parent = one<{ pid: string }>(
          db,
          `SELECT p.id AS pid FROM ${c.table} t JOIN ${f.parent} p ON p.id = t.${f.column} WHERE t.id = ? AND t.deleted_at IS NULL AND p.deleted_at IS NOT NULL`,
          c.row_id,
        );
        if (parent) {
          const top = topDeleted(db, f.parent, parent.pid);
          const d = describe(db, top.table, top.id);
          throw new ValidationError(`Restaure antes ${withArticle(top.table)} “${d.title}”, que também está na lixeira.`);
        }
      }
    }
    run(db, "DELETE FROM trash_item WHERE id = ?", id);
  });
}

const FEMININE = new Set(["organization", "activity", "note", "product_category", "tag", "stage", "team", "custom_field_group"]);
const withArticle = (table: string) => `${FEMININE.has(table) ? "a" : "o"} ${ENTITY_LABEL[table]?.toLowerCase() ?? "registro"}`;

/** Sobe pelos "pais" excluídos (etapa → funil) para pedir o de cima. */
function topDeleted(db: DatabaseSync, table: string, id: string): { table: string; id: string } {
  for (const f of foreignKeys(db).filter((r) => r.notNull && r.table === table)) {
    const p = one<{ pid: string }>(
      db,
      `SELECT p.id AS pid FROM ${table} t JOIN ${f.parent} p ON p.id = t.${f.column} WHERE t.id = ? AND p.deleted_at IS NOT NULL`,
      id,
    );
    if (p) return topDeleted(db, f.parent, p.pid);
  }
  return { table, id };
}

// ---------- Excluir definitivamente ----------

/** Tabelas que só existem por causa do "dono" (coluna) e saem junto com ele. */
const OWNED_BY: Partial<Record<DataTable, string[]>> = {
  stage: ["pipeline_id"],
  deal_stage_history: ["deal_id"],
  deal_participant: ["deal_id", "person_id"],
  deal_item: ["deal_id"],
  team_member: ["team_id"],
  person_organization: ["person_id", "organization_id"],
  entity_tag: ["tag_id"],
  custom_field_option: ["field_id"],
  custom_field_pipeline: ["field_id", "pipeline_id"],
  custom_field_value: ["field_id"],
  document_link: ["document_id"],
  activity_reminder: ["activity_id"],
};
/** Vínculos "polimórficos" (entity_id sem chave estrangeira). */
const POLYMORPHIC: { table: DataTable; column: string }[] = [
  { table: "entity_tag", column: "entity_id" },
  { table: "custom_field_value", column: "entity_id" },
  { table: "document_link", column: "entity_id" },
  { table: "note", column: "entity_id" },
  { table: "attachment", column: "entity_id" },
  { table: "external_ref", column: "local_id" },
  { table: "record_origin", column: "local_id" },
  { table: "whatsapp_send", column: "activity_id" },
];

class Blocked extends Error {}

function logPurge(db: DatabaseSync, ctx: DbContext, table: string, id: string): void {
  run(db, "DELETE FROM change_log WHERE table_name = ? AND row_id = ?", table, id);
  run(
    db,
    `INSERT INTO change_log (id, workspace_id, table_name, row_id, op, changes, row_version, user_id, at)
     VALUES (?, ?, ?, ?, 'delete', ?, 0, ?, ?)`,
    newId(),
    ctx.workspaceId,
    table,
    id,
    JSON.stringify({ purged: [false, true] }),
    ctx.userId,
    nowIso(),
  );
}

/** Apaga a linha e o que depende dela. Registro ativo que dependa dela (obrigatoriamente) impede. */
function hardDelete(db: DatabaseSync, ctx: DbContext, table: DataTable, id: string, seen: Set<string>): void {
  const key = `${table}:${id}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (!one(db, `SELECT 1 FROM ${table} WHERE id = ?`, id)) return;
  for (const p of POLYMORPHIC) {
    if (p.table === table) continue;
    for (const r of many<{ id: string }>(db, `SELECT id FROM ${p.table} WHERE ${p.column} = ?`, id)) hardDelete(db, ctx, p.table, r.id, seen);
  }
  for (const f of foreignKeys(db).filter((r) => r.parent === table)) {
    const rows = many<{ id: string; deleted_at: string | null }>(db, `SELECT id, deleted_at FROM ${f.table} WHERE ${f.column} = ?`, id);
    for (const r of rows) {
      if (!f.notNull) {
        run(db, `UPDATE ${f.table} SET ${f.column} = NULL WHERE id = ?`, r.id);
        continue;
      }
      if (r.deleted_at || OWNED_BY[f.table]?.includes(f.column)) hardDelete(db, ctx, f.table, r.id, seen);
      else throw new Blocked(`${f.table}.${f.column}`);
    }
  }
  run(db, `DELETE FROM ${table} WHERE id = ?`, id);
  logPurge(db, ctx, table, id);
}

export interface PurgeResult {
  purged: number;
  /** Arquivos de documentos que ficaram sem uso (a tela apaga o conteúdo). */
  orphans: OrphanBlob[];
}

/** Exclui definitivamente os itens (sem volta). */
export function purgeTrash(db: DatabaseSync, ctx: DbContext, ids: string[], purgeDocuments: (ids: string[]) => OrphanBlob[]): PurgeResult {
  const out: PurgeResult = { purged: 0, orphans: [] };
  withTransaction(db, () => {
    for (const id of ids) {
      const item = one<{ entity: string; record_id: string; changes: string }>(db, "SELECT entity, record_id, changes FROM trash_item WHERE id = ?", id);
      if (!item) continue;
      if (item.entity === "document") {
        out.orphans.push(...purgeDocuments([item.record_id]));
      } else {
        const deleted = (JSON.parse(item.changes) as LoggedChange[]).filter((c) => c.op === "delete");
        // Principal por último: os que foram junto (atividades, notas...) saem antes.
        const order = [...deleted.filter((c) => c.row_id !== item.record_id), ...deleted.filter((c) => c.row_id === item.record_id)];
        for (const c of order) {
          if (!(DATA_TABLES as readonly string[]).includes(c.table)) continue;
          if (!one(db, `SELECT 1 FROM ${c.table} WHERE id = ? AND deleted_at IS NOT NULL`, c.row_id)) continue; // voltou a ser usado
          db.exec("SAVEPOINT purge_row");
          try {
            hardDelete(db, ctx, c.table, c.row_id, new Set());
            db.exec("RELEASE purge_row");
          } catch (e) {
            db.exec("ROLLBACK TO purge_row");
            db.exec("RELEASE purge_row");
            // Ainda referenciado por um registro ativo (ex.: etapa no histórico de um
            // cartão): fica só como marca de excluído, fora da lixeira.
            if (!(e instanceof Blocked)) throw e;
          }
        }
      }
      run(db, "DELETE FROM trash_item WHERE id = ?", id);
      out.purged++;
    }
  });
  return out;
}

/** Itens com o prazo vencido. */
export function expiredTrashIds(db: DatabaseSync, now = new Date()): string[] {
  const limit = new Date(now.getTime() - retentionDays(db) * 86400_000).toISOString();
  return many<{ id: string }>(db, "SELECT id FROM trash_item WHERE deleted_at < ?", limit).map((r) => r.id);
}

export function allTrashIds(db: DatabaseSync, viewer: Viewer | null): string[] {
  return listTrash(db, viewer).map((t) => t.id);
}
