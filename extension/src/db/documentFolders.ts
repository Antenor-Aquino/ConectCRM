// Pastas do GED (spec 08, seção Pastas): organização opcional, como no
// computador. Um documento fica em no máximo uma pasta (document.folder_id);
// a pasta é só organização na tela — o arquivo continua guardado onde estava.
// Até 5 níveis; o nome não se repete dentro da mesma pasta. Excluir uma pasta
// manda ela para a lixeira e sobe o que havia dentro (documentos e
// subpastas) para a pasta de cima; restaurar devolve tudo.
import { requireText, ValidationError } from "../lib/validate";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { moveToTrash, type TrashNotice } from "./trash";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export const MAX_FOLDER_DEPTH = 5;

export interface DocumentFolder {
  id: string;
  parent_id: string | null;
  name: string;
}

/** Pastas ativas. Uma pasta cuja pasta de cima foi excluída aparece na raiz. */
export function activeFolders(db: DatabaseSync): DocumentFolder[] {
  const rows = many<DocumentFolder>(db, "SELECT id, parent_id, name FROM document_folder WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE");
  const ids = new Set(rows.map((r) => r.id));
  return rows.map((r) => (r.parent_id && !ids.has(r.parent_id) ? { ...r, parent_id: null } : r));
}

/** Caminho de cada pasta ("Comercial › Propostas"), pelo id. */
export function folderPaths(db: DatabaseSync, folders = activeFolders(db)): Map<string, string[]> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = new Map<string, string[]>();
  const path = (id: string, seen = new Set<string>()): string[] => {
    const cached = out.get(id);
    if (cached) return cached;
    const f = byId.get(id);
    if (!f || seen.has(id)) return [];
    seen.add(id);
    const p = [...(f.parent_id ? path(f.parent_id, seen) : []), f.name];
    out.set(id, p);
    return p;
  };
  for (const f of folders) path(f.id);
  return out;
}

/** A pasta e todas as que estão dentro dela (em qualquer nível). */
export function folderAndDescendants(db: DatabaseSync, id: string, folders = activeFolders(db)): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const f of folders) if (f.parent_id === out[i]) out.push(f.id);
  return out;
}

function requireFolder(db: DatabaseSync, id: string): DocumentFolder {
  const f = one<DocumentFolder>(db, "SELECT id, parent_id, name FROM document_folder WHERE id = ? AND deleted_at IS NULL", id);
  if (!f) throw new ValidationError("Pasta não encontrada.");
  return f;
}

/** Nível da pasta (1 = na raiz). */
function depthOf(db: DatabaseSync, id: string | null): number {
  let depth = 0;
  for (let cur = id; cur; depth++) {
    cur = one<{ p: string | null }>(db, "SELECT parent_id AS p FROM document_folder WHERE id = ? AND deleted_at IS NULL", cur)?.p ?? null;
    if (depth > 50) break;
  }
  return depth;
}

/** Quantos níveis a pasta ocupa contando ela mesma (1 = sem subpastas). */
function heightOf(db: DatabaseSync, id: string): number {
  const kids = many<{ id: string }>(db, "SELECT id FROM document_folder WHERE parent_id = ? AND deleted_at IS NULL", id);
  return 1 + Math.max(0, ...kids.map((k) => heightOf(db, k.id)));
}

function checkName(db: DatabaseSync, name: string, parentId: string | null, exceptId?: string): string {
  const n = requireText(name, "Nome da pasta").slice(0, 120);
  if (/[\\/]/.test(n)) throw new ValidationError("O nome da pasta não pode ter / nem \\.");
  const dup = one<{ id: string }>(
    db,
    "SELECT id FROM document_folder WHERE deleted_at IS NULL AND COALESCE(parent_id, '') = ? AND name = ? COLLATE NOCASE AND id <> ?",
    parentId ?? "",
    n,
    exceptId ?? "",
  );
  if (dup) throw new ValidationError(`Já existe uma pasta “${n}” aqui.`);
  return n;
}

export function createFolder(db: DatabaseSync, ctx: DbContext, input: { name: string; parentId?: string | null }): string {
  const parentId = input.parentId ?? null;
  if (parentId) requireFolder(db, parentId);
  if (depthOf(db, parentId) + 1 > MAX_FOLDER_DEPTH) throw new ValidationError(`As pastas vão até ${MAX_FOLDER_DEPTH} níveis.`);
  const name = checkName(db, input.name, parentId);
  return insertRow(db, ctx, "document_folder", { name, parent_id: parentId });
}

export function renameFolder(db: DatabaseSync, ctx: DbContext, id: string, name: string): void {
  const f = requireFolder(db, id);
  updateRow(db, ctx, "document_folder", id, { name: checkName(db, name, f.parent_id, id) });
}

/** Move a pasta (com tudo o que tem dentro) para outra pasta ou para a raiz (null). */
export function moveFolder(db: DatabaseSync, ctx: DbContext, id: string, parentId: string | null): void {
  const f = requireFolder(db, id);
  if (parentId) {
    requireFolder(db, parentId);
    if (folderAndDescendants(db, id).includes(parentId)) throw new ValidationError("Não dá para mover uma pasta para dentro dela mesma.");
  }
  if (depthOf(db, parentId) + heightOf(db, id) > MAX_FOLDER_DEPTH) throw new ValidationError(`As pastas vão até ${MAX_FOLDER_DEPTH} níveis.`);
  if (f.parent_id === parentId) return;
  updateRow(db, ctx, "document_folder", id, { parent_id: parentId, name: checkName(db, f.name, parentId, id) });
}

/** Lixeira; o que havia dentro (documentos e subpastas) sobe para a pasta de cima. */
export function deleteFolder(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  const f = requireFolder(db, id);
  return moveToTrash(db, ctx, "document_folder", id, () => {
    for (const sub of many<{ id: string; name: string }>(db, "SELECT id, name FROM document_folder WHERE parent_id = ? AND deleted_at IS NULL", id)) {
      if (one(db, "SELECT 1 FROM document_folder WHERE deleted_at IS NULL AND COALESCE(parent_id, '') = ? AND name = ? COLLATE NOCASE", f.parent_id ?? "", sub.name))
        throw new ValidationError(`Já existe uma pasta “${sub.name}” na pasta de cima. Renomeie uma delas antes de excluir.`);
      updateRow(db, ctx, "document_folder", sub.id, { parent_id: f.parent_id });
    }
    for (const d of many<{ id: string }>(db, "SELECT id FROM document WHERE folder_id = ? AND purged_at IS NULL", id))
      updateRow(db, ctx, "document", d.id, { folder_id: f.parent_id });
    softDelete(db, ctx, "document_folder", id);
  });
}

/** Coloca documentos numa pasta (null = "Sem pasta"). Devolve quantos mudaram. */
export function moveDocumentsToFolder(db: DatabaseSync, ctx: DbContext, ids: string[], folderId: string | null): number {
  if (folderId) requireFolder(db, folderId);
  return withTransaction(db, () => {
    let n = 0;
    for (const id of ids) {
      const d = one<{ folder_id: string | null }>(db, "SELECT folder_id FROM document WHERE id = ? AND purged_at IS NULL", id);
      if (!d || d.folder_id === folderId) continue;
      updateRow(db, ctx, "document", id, { folder_id: folderId });
      n++;
    }
    return n;
  });
}

/** Pasta válida para gravar num documento (null quando vazia). */
export function checkFolder(db: DatabaseSync, folderId: string | null | undefined): string | null {
  if (!folderId) return null;
  requireFolder(db, folderId);
  return folderId;
}
