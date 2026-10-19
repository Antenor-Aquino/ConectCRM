// Notas de contato, organização, cartão ou tarefa.
import { requireText, ValidationError } from "../lib/validate";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { moveToTrash, type TrashNotice } from "./trash";
import { many, type DatabaseSync } from "./sql";

export type NoteEntity = "person" | "organization" | "deal" | "activity";
const TABLE: Record<NoteEntity, "person" | "organization" | "deal" | "activity"> = {
  person: "person",
  organization: "organization",
  deal: "deal",
  activity: "activity",
};

export interface Note {
  id: string;
  body: string;
  pinned: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  /** Documentos de origem (ex.: o áudio transcrito), para abrir pela nota. */
  documents: { id: string; version_id: string; name: string; filename: string; mime: string }[];
}

export function addNote(db: DatabaseSync, ctx: DbContext, entityType: NoteEntity, entityId: string, body: string, documentIds: string[] = []): string {
  if (!(entityType in TABLE)) throw new ValidationError("Tipo de cadastro inválido.");
  if (!getRow(db, TABLE[entityType], entityId)) throw new ValidationError("Registro não encontrado.");
  const docs = [...new Set(documentIds)];
  if (docs.some((d) => !getRow(db, "document", d))) throw new ValidationError("Documento da nota não encontrado.");
  return insertRow(db, ctx, "note", {
    entity_type: entityType,
    entity_id: entityId,
    body: requireText(body, "Escreva a nota."),
    document_ids: docs.length ? JSON.stringify(docs) : null,
  });
}

export function updateNote(db: DatabaseSync, ctx: DbContext, id: string, patch: { body?: string; pinned?: boolean }): void {
  const data: Record<string, string | number> = {};
  if (patch.body !== undefined) data.body = requireText(patch.body, "Escreva a nota.");
  if (patch.pinned !== undefined) data.pinned = patch.pinned ? 1 : 0;
  updateRow(db, ctx, "note", id, data);
}

export function deleteNote(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  return moveToTrash(db, ctx, "note", id, () => softDelete(db, ctx, "note", id));
}

export function listNotes(db: DatabaseSync, entityType: NoteEntity, entityId: string): Note[] {
  const rows = many<Omit<Note, "documents"> & { document_ids: string | null }>(
    db,
    `SELECT id, body, pinned, created_at, created_by, updated_at, document_ids FROM note
     WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, created_at DESC`,
    entityType,
    entityId,
  );
  return rows.map(({ document_ids, ...n }) => {
    const ids = document_ids ? (JSON.parse(document_ids) as string[]) : [];
    // Documento na lixeira ou excluído some da nota.
    const documents = ids.length
      ? many<Note["documents"][number]>(
          db,
          `SELECT d.id, v.id AS version_id, d.name, v.filename, v.mime FROM document d JOIN document_version v ON v.id = d.current_version_id
           WHERE d.id IN (${ids.map(() => "?").join(", ")}) AND d.deleted_at IS NULL AND d.purged_at IS NULL`,
          ...ids,
        )
      : [];
    return { ...n, documents };
  });
}
