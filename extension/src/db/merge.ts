// Mesclar cadastros duplicados (spec 03 e 04): tudo o que aponta para o
// registro removido passa a apontar para o mantido; campos vazios do mantido
// são completados; o removido vai para a lixeira (exclusão lógica).
import { ValidationError } from "../lib/validate";
import { getCustomValues, setCustomValues, type CustomValue } from "./customFields";
import { deleteOrganization, deletePerson, linkPersonOrganization, setPrimaryOrganization } from "./contacts";
import { getRow, updateRow, type DataTable, type DbContext, type Row } from "./repo";
import { many, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { getEntityTags, setEntityTags, type TagEntity } from "./tags";

function repoint(db: DatabaseSync, ctx: DbContext, table: DataTable, column: string, from: string, to: string, extra = ""): void {
  for (const r of many<{ id: string }>(db, `SELECT id FROM ${table} WHERE ${column} = ? AND deleted_at IS NULL${extra}`, from)) {
    updateRow(db, ctx, table, r.id, { [column]: to });
  }
}

function fillBlanks(keep: Row, remove: Row, cols: string[]): Record<string, SqlValue> {
  const data: Record<string, SqlValue> = {};
  for (const c of cols) if ((keep[c] === null || keep[c] === "") && remove[c] !== null && remove[c] !== "") data[c] = remove[c]!;
  return data;
}

function mergeTagsAndFields(db: DatabaseSync, ctx: DbContext, entity: TagEntity & ("person" | "organization"), keepId: string, removeId: string): void {
  const tagIds = [...new Set([...getEntityTags(db, keepId), ...getEntityTags(db, removeId)].map((t) => t.id))];
  setEntityTags(db, ctx, entity, keepId, tagIds);
  const keepValues = getCustomValues(db, keepId);
  const missing: Record<string, CustomValue> = {};
  for (const [field, value] of Object.entries(getCustomValues(db, removeId))) if (keepValues[field] === undefined) missing[field] = value;
  setCustomValues(db, ctx, entity, keepId, missing);
}

export function mergePersons(db: DatabaseSync, ctx: DbContext, keepId: string, removeId: string): void {
  if (keepId === removeId) throw new ValidationError("Escolha dois contatos diferentes.");
  withTransaction(db, () => {
    const keep = getRow(db, "person", keepId);
    const remove = getRow(db, "person", removeId);
    if (!keep || !remove) throw new ValidationError("Contato não encontrado.");
    repoint(db, ctx, "deal", "person_id", removeId, keepId);
    repoint(db, ctx, "deal_participant", "person_id", removeId, keepId);
    repoint(db, ctx, "activity", "person_id", removeId, keepId);
    repoint(db, ctx, "whatsapp_capture", "person_id", removeId, keepId);
    repoint(db, ctx, "note", "entity_id", removeId, keepId, " AND entity_type = 'person'");
    const orgs = many<{ organization_id: string }>(db, "SELECT organization_id FROM person_organization WHERE person_id = ? AND deleted_at IS NULL", removeId);
    for (const o of orgs) linkPersonOrganization(db, ctx, keepId, o.organization_id);
    mergeTagsAndFields(db, ctx, "person", keepId, removeId);
    const data = fillBlanks(keep, remove, ["email", "phone", "phone_country", "avatar_id", "owner_id"]);
    if (remove.notes) data.notes = keep.notes ? `${keep.notes}\n\n${remove.notes}` : remove.notes;
    deletePerson(db, ctx, removeId);
    updateRow(db, ctx, "person", keepId, data);
  });
}

export function mergeOrganizations(db: DatabaseSync, ctx: DbContext, keepId: string, removeId: string): void {
  if (keepId === removeId) throw new ValidationError("Escolha duas organizações diferentes.");
  withTransaction(db, () => {
    const keep = getRow(db, "organization", keepId);
    const remove = getRow(db, "organization", removeId);
    if (!keep || !remove) throw new ValidationError("Organização não encontrada.");
    repoint(db, ctx, "deal", "organization_id", removeId, keepId);
    repoint(db, ctx, "activity", "organization_id", removeId, keepId);
    repoint(db, ctx, "note", "entity_id", removeId, keepId, " AND entity_type = 'organization'");
    const links = many<{ person_id: string; is_primary: number }>(
      db,
      "SELECT person_id, is_primary FROM person_organization WHERE organization_id = ? AND deleted_at IS NULL",
      removeId,
    );
    for (const l of links) linkPersonOrganization(db, ctx, l.person_id, keepId);
    mergeTagsAndFields(db, ctx, "organization", keepId, removeId);
    const data = fillBlanks(keep, remove, [
      "legal_name", "cnpj", "website", "segment", "owner_id", "phone", "phone_country", "email",
      "cep", "street", "number", "complement", "district", "city", "state", "logo_id", "cnpj_data",
    ]);
    if (remove.description) data.description = keep.description ? `${keep.description}\n\n${remove.description}` : remove.description;
    // Exclui antes de completar (o CNPJ é único entre registros ativos).
    deleteOrganization(db, ctx, removeId);
    updateRow(db, ctx, "organization", keepId, data);
    // Quem tinha a removida como principal passa a ter a mantida.
    for (const l of links) if (l.is_primary) setPrimaryOrganization(db, ctx, l.person_id, keepId);
  });
}
