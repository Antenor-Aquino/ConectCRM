// GED (spec 08): documentos com nome, classificação, validade, palavras-chave,
// versões e vínculos múltiplos (contato, organização, cartão, tarefa).
// O conteúdo dos arquivos não fica aqui: file_blob só diz onde está
// (navegador ou pasta escolhida), pelo SHA-256 (ver lib/fileStore).
import { nowIso } from "../lib/ids";
import { likeTerm, normalizeText, searchTerms } from "../lib/search";
import { optionalText, requireText, ValidationError } from "../lib/validate";
import { activityScope } from "./activities";
import { cardScope } from "./deals";
import { insertRow, restore, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, run, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { getEntityTags, setEntityTags } from "./tags";
import type { Viewer } from "./users";

export type DocLinkType = "person" | "organization" | "deal" | "activity";
export const DOC_LINK_TYPES: DocLinkType[] = ["deal", "activity", "person", "organization"];

export interface DocLinkRef {
  type: DocLinkType;
  id: string;
  /** Criado pelo contexto da tela (ex.: o contato do cartão). */
  auto?: boolean;
}

export interface DocLink extends DocLinkRef {
  label: string;
  /** Funil do cartão (para abrir no lugar certo). */
  pipeline_id: string | null;
  sub: string | null;
}

// ---------- Tipos (classificação) ----------

export interface DocumentType {
  id: string;
  name: string;
  color: string;
  valid_days: number | null;
  active: number;
  position: number;
}

export const DEFAULT_DOCUMENT_TYPES: { name: string; color: string; validDays?: number }[] = [
  { name: "Comprovante de endereço", color: "blue", validDays: 90 },
  { name: "Documento de identificação", color: "violet" },
  { name: "CPF/CNPJ", color: "indigo" },
  { name: "Contrato", color: "green" },
  { name: "Proposta", color: "orange" },
  { name: "Nota fiscal", color: "amber" },
  { name: "Comprovante de pagamento", color: "teal" },
  { name: "Certificado", color: "pink", validDays: 365 },
  { name: "Foto/imagem", color: "sky" },
  { name: "Outros", color: "slate" },
];

/** Tipos padrão numa base que ainda não tem nenhum (nova ou atualizada). */
export function ensureDocumentTypes(db: DatabaseSync, ctx: DbContext): void {
  if (one(db, "SELECT 1 FROM document_type LIMIT 1")) return;
  DEFAULT_DOCUMENT_TYPES.forEach((t, i) => insertRow(db, ctx, "document_type", { name: t.name, color: t.color, valid_days: t.validDays ?? null, position: i }));
}

export function listDocumentTypes(db: DatabaseSync, opts: { includeInactive?: boolean } = {}): DocumentType[] {
  return many<DocumentType>(
    db,
    `SELECT id, name, color, valid_days, active, position FROM document_type
     WHERE deleted_at IS NULL ${opts.includeInactive ? "" : "AND active = 1"} ORDER BY position, name`,
  );
}

export interface DocumentTypeInput {
  name: string;
  color?: string;
  validDays?: number | null;
  active?: boolean;
  position?: number;
}

function checkValidDays(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 1 || v > 3650) throw new ValidationError("Validade padrão: de 1 a 3650 dias.");
  return v;
}

export function createDocumentType(db: DatabaseSync, ctx: DbContext, input: DocumentTypeInput): string {
  const name = requireText(input.name, "Nome do tipo");
  if (one(db, "SELECT 1 FROM document_type WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL", name))
    throw new ValidationError("Já existe um tipo com esse nome.");
  const pos = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM document_type WHERE deleted_at IS NULL")?.p ?? -1;
  return insertRow(db, ctx, "document_type", { name, color: input.color ?? "slate", valid_days: checkValidDays(input.validDays), position: pos + 1 });
}

export function updateDocumentType(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<DocumentTypeInput>): void {
  const data: Record<string, SqlValue> = {};
  if (patch.name !== undefined) {
    const name = requireText(patch.name, "Nome do tipo");
    if (one(db, "SELECT 1 FROM document_type WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?", name, id))
      throw new ValidationError("Já existe um tipo com esse nome.");
    data.name = name;
  }
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.validDays !== undefined) data.valid_days = checkValidDays(patch.validDays);
  if (patch.active !== undefined) data.active = patch.active ? 1 : 0;
  if (patch.position !== undefined) data.position = patch.position;
  updateRow(db, ctx, "document_type", id, data);
}

/** Documentos do tipo ficam "não classificados". */
export function deleteDocumentType(db: DatabaseSync, ctx: DbContext, id: string): void {
  withTransaction(db, () => {
    for (const d of many<{ id: string }>(db, "SELECT id FROM document WHERE type_id = ?", id)) updateRow(db, ctx, "document", d.id, { type_id: null });
    softDelete(db, ctx, "document_type", id);
  });
}

// ---------- Arquivos (conteúdo fora do banco) ----------

export type BlobLocation = "browser" | "folder" | "legacy";

export interface FileRef {
  sha256: string;
  mime: string;
  size: number;
  filename: string;
  location: "browser" | "folder";
  path?: string | null;
  /** Texto extraído (PDF), para a busca. null = não extraído. */
  text?: string | null;
}

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{64}$/;

function cleanFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 160) || "arquivo"
  );
}

/** Texto de busca guardado já normalizado (e com limite). */
function cleanText(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = normalizeText(text);
  return t ? t.slice(0, 300_000) : null;
}

/** Registro do arquivo (reaproveita se o mesmo conteúdo já existe). */
function ensureBlob(db: DatabaseSync, ctx: DbContext, f: FileRef): string {
  if (!SHA_RE.test(f.sha256)) throw new ValidationError("Arquivo inválido (resumo SHA-256).");
  if (!(f.size > 0)) throw new ValidationError("Arquivo vazio.");
  if (f.size > MAX_DOCUMENT_BYTES) throw new ValidationError(`"${f.filename}" passa de 25 MB.`);
  const existing = one<{ id: string }>(db, "SELECT id FROM file_blob WHERE sha256 = ? AND deleted_at IS NULL", f.sha256);
  if (existing) return existing.id;
  return insertRow(db, ctx, "file_blob", {
    sha256: f.sha256,
    mime: f.mime || "application/octet-stream",
    size_bytes: f.size,
    location: f.location,
    path: f.path ?? null,
  });
}

function insertVersion(db: DatabaseSync, ctx: DbContext, documentId: string, number: number, f: FileRef): string {
  const blobId = ensureBlob(db, ctx, f);
  const text = cleanText(f.text);
  const isPdf = f.mime === "application/pdf";
  return insertRow(db, ctx, "document_version", {
    document_id: documentId,
    number,
    blob_id: blobId,
    filename: cleanFilename(f.filename),
    mime: f.mime || "application/octet-stream",
    size_bytes: f.size,
    text_content: text,
    text_status: text ? "done" : isPdf && f.text === undefined ? "pending" : "none",
  });
}

// ---------- Vínculos ----------

/** Vínculos automáticos de quem anexa numa tela: tudo que faz parte dela. */
export function contextLinks(db: DatabaseSync, type: DocLinkType, id: string): DocLinkRef[] {
  const out: DocLinkRef[] = [{ type, id }];
  const add = (t: DocLinkType, v: string | null | undefined) => {
    if (v && !out.some((l) => l.type === t && l.id === v)) out.push({ type: t, id: v, auto: true });
  };
  if (type === "activity") {
    const a = one<{ deal_id: string | null; person_id: string | null; organization_id: string | null; dp: string | null; dorg: string | null }>(
      db,
      `SELECT a.deal_id, a.person_id, a.organization_id, d.person_id AS dp, d.organization_id AS dorg
       FROM activity a LEFT JOIN deal d ON d.id = a.deal_id AND d.deleted_at IS NULL WHERE a.id = ?`,
      id,
    );
    add("deal", a?.deal_id);
    add("person", a?.person_id ?? a?.dp);
    add("organization", a?.organization_id ?? a?.dorg);
  } else if (type === "deal") {
    const d = one<{ person_id: string | null; organization_id: string | null }>(db, "SELECT person_id, organization_id FROM deal WHERE id = ?", id);
    add("person", d?.person_id);
    add("organization", d?.organization_id);
  } else if (type === "person") {
    for (const o of many<{ id: string }>(
      db,
      `SELECT o.id FROM person_organization po JOIN organization o ON o.id = po.organization_id AND o.deleted_at IS NULL
       WHERE po.person_id = ? AND po.deleted_at IS NULL ORDER BY o.name`,
      id,
    ))
      add("organization", o.id);
  }
  return out;
}

const LINK_TABLE: Record<DocLinkType, string> = { person: "person", organization: "organization", deal: "deal", activity: "activity" };

function checkLinkTarget(db: DatabaseSync, l: DocLinkRef): void {
  if (!DOC_LINK_TYPES.includes(l.type)) throw new ValidationError("Tipo de vínculo inválido.");
  if (!one(db, `SELECT 1 FROM ${LINK_TABLE[l.type]} WHERE id = ? AND deleted_at IS NULL`, l.id))
    throw new ValidationError("Registro do vínculo não encontrado.");
}

function addLinkRow(db: DatabaseSync, ctx: DbContext, documentId: string, l: DocLinkRef): boolean {
  if (one(db, "SELECT 1 FROM document_link WHERE document_id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL", documentId, l.type, l.id))
    return false;
  checkLinkTarget(db, l);
  insertRow(db, ctx, "document_link", { document_id: documentId, entity_type: l.type, entity_id: l.id, auto: l.auto ? 1 : 0 });
  return true;
}

export function addDocumentLinks(db: DatabaseSync, ctx: DbContext, documentId: string, links: DocLinkRef[]): number {
  return withTransaction(db, () => links.filter((l) => addLinkRow(db, ctx, documentId, l)).length);
}

export function removeDocumentLink(db: DatabaseSync, ctx: DbContext, documentId: string, type: DocLinkType, entityId: string): void {
  const row = one<{ id: string }>(
    db,
    "SELECT id FROM document_link WHERE document_id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL",
    documentId,
    type,
    entityId,
  );
  if (row) softDelete(db, ctx, "document_link", row.id);
}

export function documentLinks(db: DatabaseSync, documentIds: string[]): Map<string, DocLink[]> {
  const out = new Map<string, DocLink[]>();
  if (documentIds.length === 0) return out;
  const marks = documentIds.map(() => "?").join(", ");
  const rows = many<{ document_id: string; type: DocLinkType; id: string; auto: number; label: string | null; pipeline_id: string | null; sub: string | null }>(
    db,
    `SELECT l.document_id, l.entity_type AS type, l.entity_id AS id, l.auto,
       CASE l.entity_type WHEN 'deal' THEN d.title WHEN 'activity' THEN a.title WHEN 'person' THEN p.name ELSE o.name END AS label,
       d.pipeline_id, CASE l.entity_type WHEN 'deal' THEN pl.name END AS sub
     FROM document_link l
     LEFT JOIN deal d ON l.entity_type = 'deal' AND d.id = l.entity_id
     LEFT JOIN pipeline pl ON pl.id = d.pipeline_id
     LEFT JOIN activity a ON l.entity_type = 'activity' AND a.id = l.entity_id
     LEFT JOIN person p ON l.entity_type = 'person' AND p.id = l.entity_id
     LEFT JOIN organization o ON l.entity_type = 'organization' AND o.id = l.entity_id
     WHERE l.document_id IN (${marks}) AND l.deleted_at IS NULL
       AND COALESCE(d.deleted_at, a.deleted_at, p.deleted_at, o.deleted_at) IS NULL
     ORDER BY CASE l.entity_type WHEN 'deal' THEN 0 WHEN 'activity' THEN 1 WHEN 'person' THEN 2 ELSE 3 END, label`,
    ...documentIds,
  );
  for (const r of rows) {
    const list = out.get(r.document_id) ?? [];
    list.push({ type: r.type, id: r.id, auto: r.auto === 1, label: r.label ?? "(sem nome)", pipeline_id: r.pipeline_id, sub: r.sub });
    out.set(r.document_id, list);
  }
  return out;
}

// ---------- Documento ----------

export interface DocumentInput {
  name: string;
  /** Obrigatória ao cadastrar (só os anexos antigos ficam sem). */
  typeId: string | null;
  description?: string | null;
  docDate?: string | null;
  validUntil?: string | null;
  restricted?: boolean;
  tagIds?: string[];
  links?: DocLinkRef[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function checkDate(v: string | null | undefined, label: string): string | null {
  if (!v) return null;
  if (!DATE_RE.test(v) || Number.isNaN(new Date(`${v}T00:00:00`).getTime())) throw new ValidationError(`${label}: data inválida.`);
  return v;
}

function checkType(db: DatabaseSync, typeId: string | null | undefined): string {
  if (!typeId) throw new ValidationError("Escolha a classificação do documento.");
  if (!one(db, "SELECT 1 FROM document_type WHERE id = ? AND deleted_at IS NULL", typeId)) throw new ValidationError("Classificação não encontrada.");
  return typeId;
}

export function createDocument(db: DatabaseSync, ctx: DbContext, input: DocumentInput & { file: FileRef }): string {
  const name = requireText(input.name, "Nome do documento").slice(0, 200);
  const typeId = checkType(db, input.typeId);
  const docDate = checkDate(input.docDate, "Data do documento");
  const validUntil = checkDate(input.validUntil, "Validade");
  return withTransaction(db, () => {
    const id = insertRow(db, ctx, "document", {
      name,
      type_id: typeId,
      description: optionalText(input.description),
      doc_date: docDate,
      valid_until: validUntil,
      restricted: input.restricted ? 1 : 0,
    });
    const versionId = insertVersion(db, ctx, id, 1, input.file);
    updateRow(db, ctx, "document", id, { current_version_id: versionId });
    if (input.tagIds?.length) setEntityTags(db, ctx, "document", id, input.tagIds);
    for (const l of input.links ?? []) addLinkRow(db, ctx, id, l);
    return id;
  });
}

export function updateDocument(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<Omit<DocumentInput, "links">>): void {
  withTransaction(db, () => {
    const data: Record<string, SqlValue> = {};
    if (patch.name !== undefined) data.name = requireText(patch.name, "Nome do documento").slice(0, 200);
    if (patch.typeId !== undefined) data.type_id = checkType(db, patch.typeId);
    if (patch.description !== undefined) data.description = optionalText(patch.description);
    if (patch.docDate !== undefined) data.doc_date = checkDate(patch.docDate, "Data do documento");
    if (patch.validUntil !== undefined) data.valid_until = checkDate(patch.validUntil, "Validade");
    if (patch.restricted !== undefined) data.restricted = patch.restricted ? 1 : 0;
    if (Object.keys(data).length) updateRow(db, ctx, "document", id, data);
    if (patch.tagIds !== undefined) setEntityTags(db, ctx, "document", id, patch.tagIds);
  });
}

/** Nova versão do arquivo; a anterior continua disponível. */
export function addDocumentVersion(db: DatabaseSync, ctx: DbContext, id: string, file: FileRef): string {
  return withTransaction(db, () => {
    const n = one<{ n: number }>(db, "SELECT COALESCE(MAX(number), 0) AS n FROM document_version WHERE document_id = ?", id)!.n;
    const versionId = insertVersion(db, ctx, id, n + 1, file);
    updateRow(db, ctx, "document", id, { current_version_id: versionId });
    return versionId;
  });
}

/** Restaurar uma versão antiga cria uma nova versão com o mesmo arquivo. */
export function restoreDocumentVersion(db: DatabaseSync, ctx: DbContext, id: string, versionId: string): string {
  const v = one<{ blob_id: string; filename: string; mime: string; size_bytes: number; text_content: string | null; text_status: string }>(
    db,
    "SELECT blob_id, filename, mime, size_bytes, text_content, text_status FROM document_version WHERE id = ? AND document_id = ?",
    versionId,
    id,
  );
  if (!v) throw new ValidationError("Versão não encontrada.");
  return withTransaction(db, () => {
    const n = one<{ n: number }>(db, "SELECT COALESCE(MAX(number), 0) AS n FROM document_version WHERE document_id = ?", id)!.n;
    const newId = insertRow(db, ctx, "document_version", {
      document_id: id,
      number: n + 1,
      blob_id: v.blob_id,
      filename: v.filename,
      mime: v.mime,
      size_bytes: v.size_bytes,
      text_content: v.text_content,
      text_status: v.text_status,
    });
    updateRow(db, ctx, "document", id, { current_version_id: newId });
    return newId;
  });
}

/** Para a lixeira (some de todos os cadastros; pode ser restaurado). */
export function trashDocument(db: DatabaseSync, ctx: DbContext, id: string): void {
  softDelete(db, ctx, "document", id);
}

export function restoreDocument(db: DatabaseSync, ctx: DbContext, id: string): void {
  if (one(db, "SELECT 1 FROM document WHERE id = ? AND purged_at IS NOT NULL", id)) throw new ValidationError("Documento já excluído definitivamente.");
  restore(db, ctx, "document", id);
}

export const TRASH_DAYS = 30;

/** Arquivos que ficaram sem nenhum documento (a tela apaga o conteúdo). */
export interface OrphanBlob {
  id: string;
  sha256: string;
  location: BlobLocation;
  path: string | null;
}

/** Exclusão definitiva: marca o documento e devolve os arquivos órfãos. */
export function purgeDocuments(db: DatabaseSync, ctx: DbContext, ids: string[]): OrphanBlob[] {
  return withTransaction(db, () => {
    const at = nowIso();
    for (const id of ids) {
      if (!one(db, "SELECT 1 FROM document WHERE id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL", id)) continue;
      updateRow(db, ctx, "document", id, { purged_at: at });
      for (const l of many<{ id: string }>(db, "SELECT id FROM document_link WHERE document_id = ? AND deleted_at IS NULL", id))
        softDelete(db, ctx, "document_link", l.id);
    }
    const orphans = many<OrphanBlob>(
      db,
      `SELECT b.id, b.sha256, b.location, b.path FROM file_blob b
       WHERE b.deleted_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM document_version v JOIN document d ON d.id = v.document_id
         WHERE v.blob_id = b.id AND d.purged_at IS NULL)`,
    );
    for (const b of orphans) softDelete(db, ctx, "file_blob", b.id);
    return orphans;
  });
}

/** Lixeira com mais de 30 dias. */
export function expiredTrash(db: DatabaseSync, now = new Date()): string[] {
  const limit = new Date(now.getTime() - TRASH_DAYS * 86400_000).toISOString();
  return many<{ id: string }>(db, "SELECT id FROM document WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND deleted_at < ?", limit).map((r) => r.id);
}

// ---------- Permissão ----------
// Administrador vê tudo; quem enviou sempre vê. Restrito: também o
// responsável por um cartão vinculado. Os demais: vê se puder ver algum
// cadastro vinculado (contato e organização são de todos); sem vínculo, todos.

export function documentScope(db: DatabaseSync, viewer: Viewer | null | undefined, alias = "d"): { sql: string; params: SqlValue[] } {
  if (!viewer || viewer.role === "admin") return { sql: "", params: [] };
  const live = `l.document_id = ${alias}.id AND l.deleted_at IS NULL`;
  const cs = cardScope(db, viewer, "x");
  const as = activityScope(db, viewer);
  return {
    sql: ` AND (${alias}.created_by = ?
      OR (${alias}.restricted = 1 AND EXISTS (SELECT 1 FROM document_link l JOIN deal x ON x.id = l.entity_id AND l.entity_type = 'deal' WHERE ${live} AND x.owner_id = ?))
      OR (${alias}.restricted = 0 AND (
        NOT EXISTS (SELECT 1 FROM document_link l WHERE ${live})
        OR EXISTS (SELECT 1 FROM document_link l WHERE ${live} AND l.entity_type IN ('person', 'organization'))
        OR EXISTS (SELECT 1 FROM document_link l JOIN deal x ON x.id = l.entity_id AND l.entity_type = 'deal' AND x.deleted_at IS NULL WHERE ${live}${cs.sql})
        OR EXISTS (SELECT 1 FROM document_link l JOIN activity a ON a.id = l.entity_id AND l.entity_type = 'activity' AND a.deleted_at IS NULL WHERE ${live}${as.sql ? ` AND ${as.sql}` : ""})
      )))`,
    params: [viewer.id, viewer.id, ...cs.params, ...as.params],
  };
}

export function canSeeDocument(db: DatabaseSync, viewer: Viewer | null | undefined, id: string, opts: { includeTrash?: boolean } = {}): boolean {
  const s = documentScope(db, viewer);
  return !!one(
    db,
    `SELECT 1 FROM document d WHERE d.id = ? AND d.purged_at IS NULL${opts.includeTrash ? "" : " AND d.deleted_at IS NULL"}${s.sql}`,
    id,
    ...s.params,
  );
}

export function assertDocumentAccess(db: DatabaseSync, viewer: Viewer | null | undefined, id: string, opts: { includeTrash?: boolean } = {}): void {
  if (!canSeeDocument(db, viewer, id, opts)) throw new ValidationError("Documento não encontrado ou sem permissão de acesso.");
}

/** Excluir, restaurar e marcar como restrito: administrador, gestor ou quem enviou. */
export function assertDocumentOwner(db: DatabaseSync, viewer: Viewer | null | undefined, id: string): void {
  if (!viewer || viewer.role !== "vendedor") return;
  if (!one(db, "SELECT 1 FROM document WHERE id = ? AND created_by = ?", id, viewer.id))
    throw new ValidationError("Só quem enviou o documento, um gestor ou um administrador pode fazer isso.");
}

// ---------- Auditoria (acessos sem alteração) ----------

export type DocumentAction = "view" | "download";

export function logDocumentEvent(db: DatabaseSync, ctx: DbContext, documentId: string, action: DocumentAction, detail?: string | null): void {
  run(
    db,
    "INSERT INTO document_event (id, workspace_id, document_id, action, detail, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    crypto.randomUUID(),
    ctx.workspaceId,
    documentId,
    action,
    detail ?? null,
    ctx.userId,
    nowIso(),
  );
}

// ---------- Consulta ----------

export type DocFormat = "pdf" | "image" | "sheet" | "text" | "other";
export type DocValidity = "expired" | "soon" | "valid" | "none";

const FORMAT_SQL: Record<DocFormat, string> = {
  pdf: "v.mime = 'application/pdf'",
  image: "v.mime LIKE 'image/%'",
  sheet: "(v.mime LIKE '%spreadsheet%' OR v.mime LIKE '%excel%' OR v.mime = 'text/csv')",
  text: "(v.mime LIKE '%word%' OR v.mime LIKE 'text/%' OR v.mime LIKE '%opendocument.text%' OR v.mime = 'application/rtf') AND v.mime <> 'text/csv'",
  other: "",
};
FORMAT_SQL.other = `NOT (${["pdf", "image", "sheet", "text"].map((k) => `(${FORMAT_SQL[k as DocFormat]})`).join(" OR ")})`;

export interface DocumentFilter {
  search?: string;
  typeId?: string | "none";
  pipelineId?: string;
  dealId?: string;
  activityId?: string;
  personId?: string;
  organizationId?: string;
  uploadedBy?: string;
  /** Envio: AAAA-MM-DD (inclusive). */
  from?: string;
  to?: string;
  format?: DocFormat;
  validity?: DocValidity;
  unlinked?: boolean;
  tagIds?: string[];
  trash?: boolean;
  sort?: "name" | "created_at" | "valid_until" | "size" | "type";
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
  viewer?: Viewer | null;
  /** "Hoje" (AAAA-MM-DD, local) para a validade; padrão: hoje. */
  today?: string;
}

export interface DocumentListItem {
  id: string;
  name: string;
  type_id: string | null;
  type_name: string | null;
  type_color: string | null;
  description: string | null;
  doc_date: string | null;
  valid_until: string | null;
  restricted: number;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  updated_at: string;
  deleted_at: string | null;
  version_id: string;
  version_number: number;
  versions: number;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  text_status: string;
  links: DocLink[];
  tags: { id: string; name: string; color: string }[];
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

const ddmmyyyy = (col: string) =>
  `CASE WHEN ${col} IS NULL THEN '' ELSE substr(${col}, 9, 2) || '/' || substr(${col}, 6, 2) || '/' || substr(${col}, 1, 4) END`;

/** Tudo que a busca livre enxerga de um documento ("qualquer campo"). */
const HAYSTACK = `ged_norm(
  d.name || ' ' || COALESCE(d.description, '') || ' ' || COALESCE(t.name, 'nao classificado') || ' ' ||
  ${ddmmyyyy("d.doc_date")} || ' ' || ${ddmmyyyy("d.valid_until")} || ' ' || COALESCE(u.name, '') || ' ' ||
  COALESCE((SELECT group_concat(vv.filename, ' ') FROM document_version vv WHERE vv.document_id = d.id), '') || ' ' ||
  COALESCE((SELECT group_concat(tg.name, ' ') FROM entity_tag et JOIN tag tg ON tg.id = et.tag_id AND tg.deleted_at IS NULL
            WHERE et.entity_id = d.id AND et.deleted_at IS NULL), '') || ' ' ||
  COALESCE((SELECT group_concat(n, ' ') FROM (
     SELECT x.title || ' ' || COALESCE(pl.name, '') AS n FROM document_link l JOIN deal x ON x.id = l.entity_id LEFT JOIN pipeline pl ON pl.id = x.pipeline_id
       WHERE l.document_id = d.id AND l.deleted_at IS NULL AND l.entity_type = 'deal'
     UNION ALL SELECT a.title FROM document_link l JOIN activity a ON a.id = l.entity_id WHERE l.document_id = d.id AND l.deleted_at IS NULL AND l.entity_type = 'activity'
     UNION ALL SELECT p.name || ' ' || COALESCE(p.email, '') FROM document_link l JOIN person p ON p.id = l.entity_id WHERE l.document_id = d.id AND l.deleted_at IS NULL AND l.entity_type = 'person'
     UNION ALL SELECT o.name || ' ' || COALESCE(o.cnpj, '') FROM document_link l JOIN organization o ON o.id = l.entity_id WHERE l.document_id = d.id AND l.deleted_at IS NULL AND l.entity_type = 'organization'
  )), '')
) || ' ' || COALESCE(v.text_content, '')`;

/** Função de normalização usada na busca (registrada a cada consulta; é barato). */
function registerSearch(db: DatabaseSync): void {
  db.createFunction("ged_norm", (s) => (s == null ? "" : normalizeText(String(s))));
}

function documentWhere(db: DatabaseSync, f: DocumentFilter): { sql: string; params: SqlValue[] } {
  const where = ["d.purged_at IS NULL", f.trash ? "d.deleted_at IS NOT NULL" : "d.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  const add = (sql: string, ...p: SqlValue[]) => {
    where.push(sql);
    params.push(...p);
  };
  const linked = (type: DocLinkType, id: string) =>
    add("EXISTS (SELECT 1 FROM document_link l WHERE l.document_id = d.id AND l.deleted_at IS NULL AND l.entity_type = ? AND l.entity_id = ?)", type, id);
  if (f.typeId === "none") add("d.type_id IS NULL");
  else if (f.typeId) add("d.type_id = ?", f.typeId);
  if (f.dealId) linked("deal", f.dealId);
  if (f.activityId) linked("activity", f.activityId);
  if (f.personId) linked("person", f.personId);
  if (f.organizationId) linked("organization", f.organizationId);
  if (f.pipelineId) {
    add(
      "EXISTS (SELECT 1 FROM document_link l JOIN deal x ON x.id = l.entity_id WHERE l.document_id = d.id AND l.deleted_at IS NULL AND l.entity_type = 'deal' AND x.pipeline_id = ?)",
      f.pipelineId,
    );
  }
  if (f.unlinked) add("NOT EXISTS (SELECT 1 FROM document_link l WHERE l.document_id = d.id AND l.deleted_at IS NULL)");
  if (f.uploadedBy) add("d.created_by = ?", f.uploadedBy);
  if (f.from) add("d.created_at >= ?", new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) add("d.created_at < ?", new Date(`${addDays(f.to, 1)}T00:00:00`).toISOString());
  if (f.format) add(FORMAT_SQL[f.format]);
  const today = f.today ?? localDate();
  if (f.validity === "expired") add("d.valid_until < ?", today);
  else if (f.validity === "soon") add("d.valid_until >= ? AND d.valid_until <= ?", today, addDays(today, 30));
  else if (f.validity === "valid") add("d.valid_until > ?", addDays(today, 30));
  else if (f.validity === "none") add("d.valid_until IS NULL");
  for (const tagId of f.tagIds ?? []) add("EXISTS (SELECT 1 FROM entity_tag et WHERE et.entity_id = d.id AND et.tag_id = ? AND et.deleted_at IS NULL)", tagId);
  const scope = documentScope(db, f.viewer);
  if (scope.sql) add(scope.sql.replace(/^ AND /, ""), ...scope.params);
  return { sql: where.join(" AND "), params };
}

const SORT_SQL: Record<NonNullable<DocumentFilter["sort"]>, string> = {
  name: "name COLLATE NOCASE",
  created_at: "created_at",
  valid_until: "valid_until IS NULL, valid_until",
  size: "size_bytes",
  type: "type_name IS NULL, type_name COLLATE NOCASE",
};

const BASE_FROM = `FROM document d
  JOIN document_version v ON v.id = d.current_version_id
  JOIN file_blob b ON b.id = v.blob_id
  LEFT JOIN document_type t ON t.id = d.type_id
  LEFT JOIN app_user u ON u.id = d.created_by`;

export function listDocuments(db: DatabaseSync, f: DocumentFilter = {}): { items: DocumentListItem[]; total: number } {
  registerSearch(db);
  const { sql, params } = documentWhere(db, f);
  const terms = searchTerms(f.search ?? "");
  const termSql = terms.map(() => "hay LIKE ? ESCAPE '\\'").join(" AND ");
  const inner = `SELECT d.id, d.name, d.type_id, t.name AS type_name, t.color AS type_color, d.description, d.doc_date, d.valid_until, d.restricted,
      d.created_at, d.created_by, u.name AS created_by_name, d.updated_at, d.deleted_at, v.id AS version_id, v.number AS version_number,
      (SELECT COUNT(*) FROM document_version vc WHERE vc.document_id = d.id) AS versions,
      v.filename, v.mime, v.size_bytes, b.sha256, v.text_status${terms.length ? `, ${HAYSTACK} AS hay` : ""}
    ${BASE_FROM} WHERE ${sql}`;
  const outerWhere = terms.length ? `WHERE ${termSql}` : "";
  const allParams = [...params, ...terms.map(likeTerm)];
  const total = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM (${inner}) ${outerWhere}`, ...allParams)!.n;
  const dir = f.dir === "asc" ? "ASC" : "DESC";
  const sort = SORT_SQL[f.sort ?? "created_at"]
    .split(", ")
    .map((c) => (c.endsWith("IS NULL") ? c : `${c} ${dir}`))
    .join(", ");
  const rows = many<Omit<DocumentListItem, "links" | "tags"> & { hay?: string }>(
    db,
    `SELECT * FROM (${inner}) ${outerWhere} ORDER BY ${sort}, id LIMIT ? OFFSET ?`,
    ...allParams,
    Math.min(f.limit ?? 50, 500),
    f.offset ?? 0,
  );
  const links = documentLinks(
    db,
    rows.map((r) => r.id),
  );
  const items = rows.map(({ hay: _hay, ...r }) => ({
    ...r,
    links: links.get(r.id) ?? [],
    tags: getEntityTags(db, r.id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
  }));
  return { items, total };
}

/** Documentos de um cadastro (abas Documentos). */
export function documentsFor(db: DatabaseSync, type: DocLinkType, id: string, viewer?: Viewer | null): DocumentListItem[] {
  const key = { deal: "dealId", activity: "activityId", person: "personId", organization: "organizationId" }[type] as "dealId";
  return listDocuments(db, { [key]: id, viewer, limit: 500, sort: "created_at" }).items;
}

export interface DocumentVersionInfo {
  id: string;
  number: number;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  created_by_name: string | null;
}

export interface DocumentDetail extends DocumentListItem {
  tagIds: string[];
  versionList: DocumentVersionInfo[];
}

export function getDocument(db: DatabaseSync, id: string): DocumentDetail | undefined {
  const row = one<Omit<DocumentListItem, "links" | "tags">>(
    db,
    `SELECT d.id, d.name, d.type_id, t.name AS type_name, t.color AS type_color, d.description, d.doc_date, d.valid_until, d.restricted,
       d.created_at, d.created_by, u.name AS created_by_name, d.updated_at, d.deleted_at, v.id AS version_id, v.number AS version_number,
       (SELECT COUNT(*) FROM document_version vc WHERE vc.document_id = d.id) AS versions,
       v.filename, v.mime, v.size_bytes, b.sha256, v.text_status
     ${BASE_FROM} WHERE d.id = ? AND d.purged_at IS NULL`,
    id,
  );
  if (!row) return undefined;
  const tags = getEntityTags(db, id);
  return {
    ...row,
    links: documentLinks(db, [id]).get(id) ?? [],
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    tagIds: tags.map((t) => t.id),
    versionList: many<DocumentVersionInfo>(
      db,
      `SELECT v.id, v.number, v.filename, v.mime, v.size_bytes, b.sha256, v.created_at, u.name AS created_by_name
       FROM document_version v JOIN file_blob b ON b.id = v.blob_id LEFT JOIN app_user u ON u.id = v.created_by
       WHERE v.document_id = ? ORDER BY v.number DESC`,
      id,
    ),
  };
}

/** Onde está o conteúdo de uma versão (a tela lê do navegador ou da pasta). */
export interface FileLocation {
  document_id: string;
  blob_id: string;
  sha256: string;
  location: BlobLocation;
  path: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
}

export function versionFile(db: DatabaseSync, versionId: string): FileLocation | undefined {
  return one<FileLocation>(
    db,
    `SELECT v.document_id, b.id AS blob_id, b.sha256, b.location, b.path, v.filename, v.mime, v.size_bytes
     FROM document_version v JOIN file_blob b ON b.id = v.blob_id WHERE v.id = ?`,
    versionId,
  );
}

/** Documentos visíveis com o mesmo conteúdo (aviso de duplicado). */
export function documentsBySha(db: DatabaseSync, sha256: string, viewer?: Viewer | null): { id: string; name: string; type_name: string | null }[] {
  const s = documentScope(db, viewer);
  return many(
    db,
    `SELECT DISTINCT d.id, d.name, t.name AS type_name FROM document d
     JOIN document_version v ON v.document_id = d.id JOIN file_blob b ON b.id = v.blob_id
     LEFT JOIN document_type t ON t.id = d.type_id
     WHERE b.sha256 = ? AND d.deleted_at IS NULL AND d.purged_at IS NULL${s.sql}`,
    sha256,
    ...s.params,
  );
}

export function blobBySha(db: DatabaseSync, sha256: string): { id: string; location: BlobLocation; path: string | null } | undefined {
  return one(db, "SELECT id, location, path FROM file_blob WHERE sha256 = ? AND deleted_at IS NULL", sha256);
}

export interface DocumentStats {
  total: number;
  bytes: number;
  expired: number;
  soon: number;
  unclassified: number;
  unlinked: number;
  trash: number;
}

export function documentStats(db: DatabaseSync, viewer?: Viewer | null, today = localDate()): DocumentStats {
  const s = documentScope(db, viewer);
  const live = `d.purged_at IS NULL AND d.deleted_at IS NULL${s.sql}`;
  const r = one<Omit<DocumentStats, "trash" | "bytes">>(
    db,
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(d.valid_until < ?), 0) AS expired,
       COALESCE(SUM(d.valid_until >= ? AND d.valid_until <= ?), 0) AS soon,
       COALESCE(SUM(d.type_id IS NULL), 0) AS unclassified,
       COALESCE(SUM(NOT EXISTS (SELECT 1 FROM document_link l WHERE l.document_id = d.id AND l.deleted_at IS NULL)), 0) AS unlinked
     FROM document d WHERE ${live}`,
    today,
    today,
    addDays(today, 30),
    ...s.params,
  )!;
  // Espaço: cada arquivo conta uma vez (versões e duplicados compartilham).
  const bytes = one<{ n: number }>(
    db,
    `SELECT COALESCE(SUM(size_bytes), 0) AS n FROM file_blob b WHERE b.deleted_at IS NULL AND EXISTS (
       SELECT 1 FROM document_version v JOIN document d ON d.id = v.document_id WHERE v.blob_id = b.id AND ${live})`,
    ...s.params,
  )!.n;
  const trash = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM document d WHERE d.purged_at IS NULL AND d.deleted_at IS NOT NULL${s.sql}`, ...s.params)!.n;
  return { ...r, bytes, trash };
}

/** Documentos que vencem até `days` dias (para os alertas). */
export function expiringDocuments(
  db: DatabaseSync,
  days: number,
  viewer?: Viewer | null,
  today = localDate(),
): { id: string; name: string; valid_until: string }[] {
  const s = documentScope(db, viewer);
  return many(
    db,
    `SELECT d.id, d.name, d.valid_until FROM document d
     WHERE d.purged_at IS NULL AND d.deleted_at IS NULL AND d.valid_until >= ? AND d.valid_until <= ?${s.sql}
     ORDER BY d.valid_until, d.name`,
    today,
    addDays(today, days),
    ...s.params,
  );
}

// ---------- Trilha de auditoria ----------

export interface AuditEntry {
  at: string;
  user_name: string | null;
  text: string;
}

const ACTION_TEXT: Record<string, string> = { view: "Visualizou", download: "Baixou" };
/** "ao cartão" / "do cartão", "à tarefa" / "da tarefa"... */
const LINK_LABEL: Record<DocLinkType, { to: string; from: string }> = {
  deal: { to: "ao cartão", from: "do cartão" },
  activity: { to: "à atividade", from: "da atividade" },
  person: { to: "ao contato", from: "do contato" },
  organization: { to: "à organização", from: "da organização" },
};
const FIELD_LABEL: Record<string, string> = {
  name: "Nome",
  type_id: "Classificação",
  description: "Descrição",
  doc_date: "Data do documento",
  valid_until: "Validade",
  restricted: "Restrito",
};

export function documentAudit(db: DatabaseSync, id: string): AuditEntry[] {
  const typeName = (v: unknown) =>
    v ? (one<{ name: string }>(db, "SELECT name FROM document_type WHERE id = ?", String(v))?.name ?? "tipo excluído") : "não classificado";
  const fmt = (field: string, v: unknown): string => {
    if (field === "type_id") return typeName(v);
    if (field === "restricted") return v ? "sim" : "não";
    if (v == null || v === "") return "vazio";
    if (field === "doc_date" || field === "valid_until") return String(v).split("-").reverse().join("/");
    return String(v);
  };
  const linkLabel = (type: DocLinkType, eid: string, dir: "to" | "from") => {
    const table = LINK_TABLE[type];
    const col = type === "deal" || type === "activity" ? "title" : "name";
    return `${LINK_LABEL[type][dir]} ${one<{ n: string }>(db, `SELECT ${col} AS n FROM ${table} WHERE id = ?`, eid)?.n ?? "(excluído)"}`;
  };
  const out: AuditEntry[] = [];
  const logs = many<{ table_name: string; row_id: string; op: string; changes: string; at: string; user_name: string | null }>(
    db,
    `SELECT c.table_name, c.row_id, c.op, c.changes, c.at, u.name AS user_name FROM change_log c LEFT JOIN app_user u ON u.id = c.user_id
     WHERE (c.table_name = 'document' AND c.row_id = ?)
        OR (c.table_name = 'document_version' AND c.row_id IN (SELECT id FROM document_version WHERE document_id = ?))
        OR (c.table_name = 'document_link' AND c.row_id IN (SELECT id FROM document_link WHERE document_id = ?))
        OR (c.table_name = 'entity_tag' AND c.row_id IN (SELECT id FROM entity_tag WHERE entity_id = ?))`,
    id,
    id,
    id,
    id,
  );
  for (const l of logs) {
    const ch = JSON.parse(l.changes || "{}") as Record<string, [unknown, unknown]>;
    const push = (text: string) => out.push({ at: l.at, user_name: l.user_name, text });
    if (l.table_name === "document") {
      if (l.op === "insert") push(`Enviou o documento "${ch.name?.[1] ?? ""}"`);
      else if (l.op === "delete") push("Moveu para a lixeira");
      else if (l.op === "restore") push("Restaurou da lixeira");
      else {
        if (ch.purged_at) push("Excluiu definitivamente");
        for (const [k, [a, b]] of Object.entries(ch)) if (FIELD_LABEL[k]) push(`${FIELD_LABEL[k]}: ${fmt(k, a)} → ${fmt(k, b)}`);
      }
    } else if (l.table_name === "document_version" && l.op === "insert") {
      push(`Versão ${ch.number?.[1]}: ${ch.filename?.[1]}`);
    } else if (l.table_name === "document_link") {
      const row = one<{ entity_type: DocLinkType; entity_id: string; auto: number }>(
        db,
        "SELECT entity_type, entity_id, auto FROM document_link WHERE id = ?",
        l.row_id,
      );
      if (!row) continue;
      if (l.op === "insert") push(`Vinculou ${linkLabel(row.entity_type, row.entity_id, "to")}${row.auto ? " (automático)" : ""}`);
      else if (l.op === "delete") push(`Desvinculou ${linkLabel(row.entity_type, row.entity_id, "from")}`);
    } else if (l.table_name === "entity_tag") {
      const tag = one<{ name: string }>(db, "SELECT t.name FROM entity_tag et JOIN tag t ON t.id = et.tag_id WHERE et.id = ?", l.row_id)?.name;
      if (l.op === "insert") push(`Adicionou a palavra-chave ${tag}`);
      else if (l.op === "delete") push(`Removeu a palavra-chave ${tag}`);
    }
  }
  for (const e of many<{ action: string; detail: string | null; at: string; user_name: string | null }>(
    db,
    "SELECT e.action, e.detail, e.at, u.name AS user_name FROM document_event e LEFT JOIN app_user u ON u.id = e.user_id WHERE e.document_id = ?",
    id,
  )) {
    out.push({ at: e.at, user_name: e.user_name, text: `${ACTION_TEXT[e.action] ?? e.action}${e.detail ? ` ${e.detail}` : ""}` });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// ---------- Manutenção dos arquivos ----------

/** Anexos antigos ainda dentro do banco (mudam para o depósito em open). */
export function legacyBlobs(db: DatabaseSync): { id: string; mime: string }[] {
  return many(db, "SELECT id, mime FROM file_blob WHERE location = 'legacy' AND deleted_at IS NULL");
}

export function legacyBytes(db: DatabaseSync, blobId: string): Uint8Array | null {
  return one<{ data: Uint8Array }>(db, "SELECT data FROM attachment WHERE id = ?", blobId)?.data ?? null;
}

/** Conclui a mudança de um anexo antigo: grava o SHA-256 e esvazia o anexo. */
export function finishLegacyBlob(db: DatabaseSync, ctx: DbContext, blobId: string, sha256: string): void {
  withTransaction(db, () => {
    const dup = one<{ id: string }>(db, "SELECT id FROM file_blob WHERE sha256 = ? AND deleted_at IS NULL AND id <> ?", sha256, blobId);
    if (dup) {
      run(db, "UPDATE document_version SET blob_id = ? WHERE blob_id = ?", dup.id, blobId);
      softDelete(db, ctx, "file_blob", blobId);
    } else {
      updateRow(db, ctx, "file_blob", blobId, { sha256, location: "browser" });
    }
    // Conteúdo já está no depósito; o registro antigo fica só como histórico.
    run(db, "UPDATE attachment SET data = X'' WHERE id = ?", blobId);
  });
}

/** Arquivos ainda no navegador (para mudar para a pasta escolhida). */
export function browserBlobs(
  db: DatabaseSync,
): { id: string; sha256: string; mime: string; size_bytes: number; name: string; filename: string; created_at: string }[] {
  return many(
    db,
    `SELECT b.id, b.sha256, b.mime, b.size_bytes, b.created_at,
       (SELECT d.name FROM document_version v JOIN document d ON d.id = v.document_id WHERE v.blob_id = b.id ORDER BY v.created_at LIMIT 1) AS name,
       (SELECT v.filename FROM document_version v WHERE v.blob_id = b.id ORDER BY v.created_at LIMIT 1) AS filename
     FROM file_blob b WHERE b.location = 'browser' AND b.deleted_at IS NULL`,
  );
}

export function setBlobLocation(db: DatabaseSync, ctx: DbContext, blobId: string, location: "browser" | "folder", path: string | null): void {
  updateRow(db, ctx, "file_blob", blobId, { location, path });
}

/** Arquivos restaurados de um backup para o navegador. */
export function markInBrowser(db: DatabaseSync, ctx: DbContext, sha256s: string[]): number {
  return withTransaction(db, () => {
    let n = 0;
    for (const sha of sha256s) {
      const b = one<{ id: string }>(db, "SELECT id FROM file_blob WHERE sha256 = ? AND deleted_at IS NULL", sha);
      if (b && updateRow(db, ctx, "file_blob", b.id, { location: "browser", path: null })) n++;
    }
    return n;
  });
}

/** Todos os arquivos em uso (backup). */
export function allBlobs(db: DatabaseSync): { sha256: string; location: BlobLocation; path: string | null; mime: string }[] {
  return many(db, "SELECT sha256, location, path, mime FROM file_blob WHERE deleted_at IS NULL AND location <> 'legacy'");
}

/** PDFs cujo texto ainda não foi lido (anexos antigos). */
export function pendingTextVersions(db: DatabaseSync, limit = 20): { id: string; document_id: string }[] {
  return many(
    db,
    `SELECT v.id, v.document_id FROM document_version v JOIN document d ON d.id = v.document_id
     JOIN file_blob b ON b.id = v.blob_id
     WHERE v.text_status = 'pending' AND d.purged_at IS NULL AND b.location <> 'legacy' LIMIT ?`,
    limit,
  );
}

export function setVersionText(db: DatabaseSync, ctx: DbContext, versionId: string, text: string | null): void {
  updateRow(db, ctx, "document_version", versionId, { text_content: cleanText(text), text_status: text ? "done" : "none" });
}

// ---------- Vínculos na tela (etiquetas e busca) ----------

/** Rótulos dos vínculos sugeridos (etiquetas da janela Novo documento). */
export function describeLinks(db: DatabaseSync, refs: DocLinkRef[]): DocLink[] {
  return refs.flatMap((r): DocLink[] => {
    if (r.type === "deal") {
      const d = one<{ title: string; pipeline_id: string; sub: string }>(
        db,
        "SELECT d.title, d.pipeline_id, p.name AS sub FROM deal d JOIN pipeline p ON p.id = d.pipeline_id WHERE d.id = ? AND d.deleted_at IS NULL",
        r.id,
      );
      return d ? [{ ...r, label: d.title, pipeline_id: d.pipeline_id, sub: d.sub }] : [];
    }
    const col = r.type === "activity" ? "title" : "name";
    const row = one<{ n: string }>(db, `SELECT ${col} AS n FROM ${LINK_TABLE[r.type]} WHERE id = ? AND deleted_at IS NULL`, r.id);
    return row ? [{ ...r, label: row.n, pipeline_id: null, sub: null }] : [];
  });
}

/** Busca cartões, tarefas, contatos e organizações para vincular. */
export function searchLinkTargets(db: DatabaseSync, q: string, viewer?: Viewer | null, limit = 8): DocLink[] {
  registerSearch(db);
  const terms = searchTerms(q);
  if (terms.length === 0) return [];
  const match = (col: string) => terms.map(() => `ged_norm(${col}) LIKE ? ESCAPE '\\'`).join(" AND ");
  const p = terms.map(likeTerm);
  const cs = cardScope(db, viewer, "d");
  const as = activityScope(db, viewer);
  const deals = many<{ id: string; label: string; pipeline_id: string; sub: string }>(
    db,
    `SELECT d.id, d.title AS label, d.pipeline_id, pl.name AS sub FROM deal d JOIN pipeline pl ON pl.id = d.pipeline_id
     WHERE d.deleted_at IS NULL AND ${match("d.title")}${cs.sql} ORDER BY d.updated_at DESC LIMIT ?`,
    ...p,
    ...cs.params,
    limit,
  ).map((r) => ({ ...r, type: "deal" as const }));
  const tasks = many<{ id: string; label: string }>(
    db,
    `SELECT a.id, a.title AS label FROM activity a WHERE a.deleted_at IS NULL AND ${match("a.title")}${as.sql ? ` AND ${as.sql}` : ""}
     ORDER BY a.due_at DESC LIMIT ?`,
    ...p,
    ...as.params,
    limit,
  ).map((r) => ({ ...r, type: "activity" as const, pipeline_id: null, sub: null }));
  const people = many<{ id: string; label: string }>(
    db,
    `SELECT id, name AS label FROM person WHERE deleted_at IS NULL AND ${match("name")} ORDER BY name LIMIT ?`,
    ...p,
    limit,
  ).map((r) => ({ ...r, type: "person" as const, pipeline_id: null, sub: null }));
  const orgs = many<{ id: string; label: string }>(
    db,
    `SELECT id, name AS label FROM organization WHERE deleted_at IS NULL AND ${match("name")} ORDER BY name LIMIT ?`,
    ...p,
    limit,
  ).map((r) => ({ ...r, type: "organization" as const, pipeline_id: null, sub: null }));
  return [...deals, ...tasks, ...people, ...orgs];
}

/** Documento com o conteúdo ainda dentro do banco (dados de exemplo): o
 * offscreen muda o conteúdo para o depósito na abertura, como os anexos antigos. */
export function seedDocumentWithBytes(
  db: DatabaseSync,
  ctx: DbContext,
  input: DocumentInput & { filename: string; mime: string; bytes: Uint8Array; text?: string | null },
): string {
  return withTransaction(db, () => {
    const blobId = insertRow(db, ctx, "attachment", {
      entity_type: "document",
      entity_id: null,
      filename: cleanFilename(input.filename),
      mime: input.mime,
      size_bytes: input.bytes.byteLength,
      data: input.bytes,
    });
    insertRow(db, ctx, "file_blob", { sha256: `legacy:${blobId}`, mime: input.mime, size_bytes: input.bytes.byteLength, location: "legacy" }, blobId);
    const id = insertRow(db, ctx, "document", {
      name: requireText(input.name, "Nome do documento"),
      type_id: input.typeId,
      description: optionalText(input.description),
      doc_date: checkDate(input.docDate, "Data do documento"),
      valid_until: checkDate(input.validUntil, "Validade"),
      restricted: input.restricted ? 1 : 0,
    });
    const text = cleanText(input.text);
    const versionId = insertRow(db, ctx, "document_version", {
      document_id: id,
      number: 1,
      blob_id: blobId,
      filename: cleanFilename(input.filename),
      mime: input.mime,
      size_bytes: input.bytes.byteLength,
      text_content: text,
      text_status: text ? "done" : "none",
    });
    updateRow(db, ctx, "document", id, { current_version_id: versionId });
    if (input.tagIds?.length) setEntityTags(db, ctx, "document", id, input.tagIds);
    for (const l of input.links ?? []) addLinkRow(db, ctx, id, l);
    return id;
  });
}
