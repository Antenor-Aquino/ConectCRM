// Notas de contato, organização, cartão ou tarefa.
import { requireText, ValidationError } from "../lib/validate";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
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
}

export function addNote(db: DatabaseSync, ctx: DbContext, entityType: NoteEntity, entityId: string, body: string): string {
  if (!(entityType in TABLE)) throw new ValidationError("Tipo de cadastro inválido.");
  if (!getRow(db, TABLE[entityType], entityId)) throw new ValidationError("Registro não encontrado.");
  return insertRow(db, ctx, "note", { entity_type: entityType, entity_id: entityId, body: requireText(body, "Escreva a nota.") });
}

export function updateNote(db: DatabaseSync, ctx: DbContext, id: string, patch: { body?: string; pinned?: boolean }): void {
  const data: Record<string, string | number> = {};
  if (patch.body !== undefined) data.body = requireText(patch.body, "Escreva a nota.");
  if (patch.pinned !== undefined) data.pinned = patch.pinned ? 1 : 0;
  updateRow(db, ctx, "note", id, data);
}

export function deleteNote(db: DatabaseSync, ctx: DbContext, id: string): void {
  softDelete(db, ctx, "note", id);
}

export function listNotes(db: DatabaseSync, entityType: NoteEntity, entityId: string): Note[] {
  return many<Note>(
    db,
    `SELECT id, body, pinned, created_at, created_by, updated_at FROM note
     WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY pinned DESC, created_at DESC`,
    entityType,
    entityId,
  );
}
