// Backup dos documentos (GED) — lado do banco: a lista do que vai para o
// espelho, cada arquivo com o caminho legível que terá lá (as mesmas pastas do
// GED e o nome do documento) e os dados do índice (indice.csv).
import { folderPaths } from "./documentFolders";
import { documentLinks, type DocLinkType } from "./documents";
import { many, type DatabaseSync } from "./sql";

export interface BackupEntry {
  /** Caminho no espelho, relativo à pasta "ConectCRM - Documentos". */
  target: string;
  sha256: string;
  mime: string;
  size: number;
  location: "browser" | "folder";
  path: string | null;
  documentId: string;
  name: string;
  typeName: string | null;
  /** Pasta do GED ("Comercial/Propostas"); vazio = sem pasta. */
  folder: string;
  version: number;
  current: boolean;
  filename: string;
  docDate: string | null;
  validUntil: string | null;
  links: string;
  createdBy: string | null;
  createdAt: string;
}

export const OLD_VERSIONS_DIR = "_versões anteriores";

const LINK_WORD: Record<DocLinkType, string> = { deal: "Cartão", activity: "Atividade", person: "Contato", organization: "Organização" };

/** Nome que serve em qualquer sistema de arquivos (Windows incluído). */
export function safeSegment(s: string): string {
  const t = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t) ? `${t}_` : t || "documento";
}

const extOf = (filename: string) => filename.match(/\.([A-Za-z0-9]{1,8})$/)?.[0].toLowerCase() ?? "";

/** Caminho do arquivo no espelho. */
export function backupTarget(e: { folder: string[]; name: string; filename: string; sha256: string; version: number; current: boolean }): string {
  const dirs = e.folder.map(safeSegment);
  const file = `${safeSegment(e.name)}${e.current ? "" : ` v${e.version}`} (${e.sha256.slice(0, 8)})${extOf(e.filename)}`;
  return [...(e.current ? [] : [OLD_VERSIONS_DIR]), ...dirs, file].join("/");
}

/** O que vai para o backup: documentos fora da lixeira (versão atual e, se pedido, as anteriores). */
export function documentBackupList(db: DatabaseSync, opts: { includeOldVersions?: boolean } = {}): BackupEntry[] {
  const rows = many<{
    document_id: string;
    name: string;
    type_name: string | null;
    folder_id: string | null;
    doc_date: string | null;
    valid_until: string | null;
    number: number;
    current: number;
    filename: string;
    sha256: string;
    mime: string;
    size_bytes: number;
    location: "browser" | "folder" | "legacy";
    path: string | null;
    created_by: string | null;
    created_at: string;
  }>(
    db,
    `SELECT d.id AS document_id, d.name, t.name AS type_name, d.folder_id, d.doc_date, d.valid_until,
       v.number, (v.id = d.current_version_id) AS current, v.filename, b.sha256, b.mime, b.size_bytes, b.location, b.path,
       u.name AS created_by, v.created_at
     FROM document d
     JOIN document_version v ON v.document_id = d.id AND v.deleted_at IS NULL
     JOIN file_blob b ON b.id = v.blob_id AND b.deleted_at IS NULL
     LEFT JOIN document_type t ON t.id = d.type_id
     LEFT JOIN app_user u ON u.id = v.created_by
     WHERE d.deleted_at IS NULL AND d.purged_at IS NULL AND b.location <> 'legacy'
     ORDER BY d.name COLLATE NOCASE, v.number DESC`,
  );
  const folders = folderPaths(db);
  const ids = [...new Set(rows.map((r) => r.document_id))];
  const links = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const [id, list] of documentLinks(db, ids.slice(i, i + 500))) links.set(id, list.map((l) => `${LINK_WORD[l.type]}: ${l.label}`).join("; "));
  }
  const currentSha = new Map(rows.filter((r) => r.current).map((r) => [r.document_id, r.sha256]));
  const seen = new Set<string>();
  const out: BackupEntry[] = [];
  for (const r of rows) {
    const current = r.current === 1;
    // Versão antiga igual à atual (restaurada) não precisa de outra cópia.
    if (!current && (!opts.includeOldVersions || currentSha.get(r.document_id) === r.sha256)) continue;
    const folder = r.folder_id ? (folders.get(r.folder_id) ?? []) : [];
    const target = backupTarget({ folder, name: r.name, filename: r.filename, sha256: r.sha256, version: r.number, current });
    if (seen.has(target.toLowerCase())) continue;
    seen.add(target.toLowerCase());
    out.push({
      target,
      sha256: r.sha256,
      mime: r.mime,
      size: r.size_bytes,
      location: r.location as "browser" | "folder",
      path: r.path,
      documentId: r.document_id,
      name: r.name,
      typeName: r.type_name,
      folder: folder.join("/"),
      version: r.number,
      current,
      filename: r.filename,
      docDate: r.doc_date,
      validUntil: r.valid_until,
      links: links.get(r.document_id) ?? "",
      createdBy: r.created_by,
      createdAt: r.created_at,
    });
  }
  return out;
}
