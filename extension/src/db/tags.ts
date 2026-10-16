// Tags separadas por entidade (spec 01, seção 8): cada tag só pode ser usada
// em registros da sua entidade.
import { badgePalette } from "../../../shared/tailadmin/src/tokens";
import { requireText, ValidationError } from "../lib/validate";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export type TagEntity = "person" | "organization" | "deal" | "ticket" | "project";
export const TAG_ENTITIES: TagEntity[] = ["person", "organization", "deal", "ticket", "project"];

export interface Tag {
  id: string;
  entity: TagEntity;
  name: string;
  color: string;
  active: number;
}

function checkEntity(entity: string): asserts entity is TagEntity {
  if (!(TAG_ENTITIES as string[]).includes(entity)) throw new ValidationError("Entidade de tag inválida.");
}

function checkColor(color: string): void {
  if (!(color in badgePalette)) throw new ValidationError("Cor de tag inválida.");
}

export function listTags(db: DatabaseSync, entity: TagEntity, opts: { includeInactive?: boolean } = {}): Tag[] {
  return many<Tag>(
    db,
    `SELECT id, entity, name, color, active FROM tag WHERE entity = ? AND deleted_at IS NULL ${opts.includeInactive ? "" : "AND active = 1"}
     ORDER BY name COLLATE NOCASE`,
    entity,
  );
}

function nameTaken(db: DatabaseSync, entity: TagEntity, name: string, exceptId = ""): boolean {
  return !!one(db, "SELECT 1 FROM tag WHERE entity = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?", entity, name, exceptId);
}

export function createTag(db: DatabaseSync, ctx: DbContext, input: { entity: TagEntity; name: string; color?: string }): string {
  checkEntity(input.entity);
  const name = requireText(input.name, "Informe o nome da tag.");
  const color = input.color ?? "slate";
  checkColor(color);
  if (nameTaken(db, input.entity, name)) throw new ValidationError(`Já existe a tag "${name}".`);
  return insertRow(db, ctx, "tag", { entity: input.entity, name, color });
}

export function updateTag(db: DatabaseSync, ctx: DbContext, id: string, patch: { name?: string; color?: string; active?: boolean }): void {
  const tag = one<Tag>(db, "SELECT id, entity, name, color, active FROM tag WHERE id = ? AND deleted_at IS NULL", id);
  if (!tag) throw new ValidationError("Tag não encontrada.");
  const data: Record<string, string | number> = {};
  if (patch.name !== undefined) {
    data.name = requireText(patch.name, "Informe o nome da tag.");
    if (nameTaken(db, tag.entity, data.name, id)) throw new ValidationError(`Já existe a tag "${data.name}".`);
  }
  if (patch.color !== undefined) {
    checkColor(patch.color);
    data.color = patch.color;
  }
  if (patch.active !== undefined) data.active = patch.active ? 1 : 0;
  updateRow(db, ctx, "tag", id, data);
}

/** Exclui a tag e a remove dos registros que a usavam. */
export function deleteTag(db: DatabaseSync, ctx: DbContext, id: string): void {
  withTransaction(db, () => {
    for (const link of many<{ id: string }>(db, "SELECT id FROM entity_tag WHERE tag_id = ? AND deleted_at IS NULL", id)) {
      softDelete(db, ctx, "entity_tag", link.id);
    }
    softDelete(db, ctx, "tag", id);
  });
}

export function getEntityTags(db: DatabaseSync, entityId: string): Tag[] {
  return many<Tag>(
    db,
    `SELECT t.id, t.entity, t.name, t.color, t.active FROM entity_tag et
     JOIN tag t ON t.id = et.tag_id AND t.deleted_at IS NULL
     WHERE et.entity_id = ? AND et.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE`,
    entityId,
  );
}

/** Substitui as tags de um registro. */
export function setEntityTags(db: DatabaseSync, ctx: DbContext, entity: TagEntity, entityId: string, tagIds: string[]): void {
  checkEntity(entity);
  withTransaction(db, () => {
    const wanted = new Set(tagIds);
    for (const tagId of wanted) {
      const tag = one<{ entity: string }>(db, "SELECT entity FROM tag WHERE id = ? AND deleted_at IS NULL", tagId);
      if (!tag) throw new ValidationError("Tag não encontrada.");
      if (tag.entity !== entity) throw new ValidationError("Esta tag pertence a outro tipo de cadastro.");
    }
    const current = many<{ id: string; tag_id: string }>(
      db,
      "SELECT id, tag_id FROM entity_tag WHERE entity_id = ? AND deleted_at IS NULL",
      entityId,
    );
    for (const link of current) {
      if (wanted.has(link.tag_id)) wanted.delete(link.tag_id);
      else softDelete(db, ctx, "entity_tag", link.id);
    }
    for (const tagId of wanted) insertRow(db, ctx, "entity_tag", { tag_id: tagId, entity_type: entity, entity_id: entityId });
  });
}

/** Quantos registros usam cada tag da entidade. */
export function tagUsage(db: DatabaseSync, entity: TagEntity): Record<string, number> {
  const rows = many<{ tag_id: string; n: number }>(
    db,
    `SELECT et.tag_id, COUNT(*) AS n FROM entity_tag et JOIN tag t ON t.id = et.tag_id
     WHERE t.entity = ? AND et.deleted_at IS NULL GROUP BY et.tag_id`,
    entity,
  );
  return Object.fromEntries(rows.map((r) => [r.tag_id, r.n]));
}
