// Campos personalizados (spec 01, seção 9): definição, opções de lista,
// restrição por funil e valores por registro.
import {
  isValidPlaceholderKey,
  normalizeEmail,
  normalizePhone,
  optionalText,
  placeholderKeyFromName,
  requireText,
  ValidationError,
} from "../lib/validate";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export type CustomFieldEntity = "person" | "organization" | "deal" | "ticket" | "project" | "activity" | "product";
export const CUSTOM_FIELD_ENTITIES: CustomFieldEntity[] = ["person", "organization", "deal", "ticket", "project", "activity", "product"];

export type CustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiselect"
  | "phone"
  | "email"
  | "url"
  | "user"
  | "person"
  | "organization";

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  text: "Texto",
  textarea: "Texto longo",
  number: "Número",
  money: "Moeda",
  date: "Data",
  datetime: "Data e hora",
  boolean: "Sim/Não",
  select: "Lista",
  multiselect: "Lista múltipla",
  phone: "Telefone",
  email: "E-mail",
  url: "URL",
  user: "Usuário",
  person: "Contato",
  organization: "Organização",
};

const PIPELINE_ENTITIES: CustomFieldEntity[] = ["deal", "ticket", "project"];
const PIPELINE_TYPE_BY_ENTITY: Record<string, string> = { deal: "comercial", ticket: "operacional", project: "projeto" };

export interface CustomFieldOption {
  id: string;
  label: string;
  color: string | null;
}

export interface CustomField {
  id: string;
  entity: CustomFieldEntity;
  name: string;
  description: string | null;
  field_type: CustomFieldType;
  placeholder_key: string;
  always_show: number;
  hidden: number;
  required: number;
  position: number;
  active: number;
  options: CustomFieldOption[];
  pipelineIds: string[];
}

export interface CustomFieldInput {
  entity: CustomFieldEntity;
  name: string;
  description?: string | null;
  fieldType: CustomFieldType;
  /** Sem chave, é gerada a partir do nome. */
  placeholderKey?: string | null;
  alwaysShow?: boolean;
  hidden?: boolean;
  required?: boolean;
  options?: { id?: string; label: string; color?: string | null }[];
  /** Só para negócio/ticket/projeto; vazio = todos os funis do tipo. */
  pipelineIds?: string[];
}

type FieldRow = Omit<CustomField, "options" | "pipelineIds">;
const FIELD_COLS = "id, entity, name, description, field_type, placeholder_key, always_show, hidden, required, position, active";

function withDetails(db: DatabaseSync, rows: FieldRow[]): CustomField[] {
  return rows.map((f) => ({
    ...f,
    options: many<CustomFieldOption>(
      db,
      "SELECT id, label, color FROM custom_field_option WHERE field_id = ? AND deleted_at IS NULL ORDER BY position",
      f.id,
    ),
    pipelineIds: many<{ pipeline_id: string }>(
      db,
      "SELECT pipeline_id FROM custom_field_pipeline WHERE field_id = ? AND deleted_at IS NULL",
      f.id,
    ).map((r) => r.pipeline_id),
  }));
}

/** Campos da entidade; com `pipelineId`, só os que valem para aquele funil. */
export function listCustomFields(
  db: DatabaseSync,
  entity: CustomFieldEntity,
  opts: { pipelineId?: string; includeInactive?: boolean } = {},
): CustomField[] {
  const rows = many<FieldRow>(
    db,
    `SELECT ${FIELD_COLS} FROM custom_field WHERE entity = ? AND deleted_at IS NULL ${opts.includeInactive ? "" : "AND active = 1"}
     ORDER BY position, name COLLATE NOCASE`,
    entity,
  );
  const fields = withDetails(db, rows);
  if (!opts.pipelineId) return fields;
  return fields.filter((f) => f.pipelineIds.length === 0 || f.pipelineIds.includes(opts.pipelineId!));
}

export function getCustomField(db: DatabaseSync, id: string): CustomField | undefined {
  const row = one<FieldRow>(db, `SELECT ${FIELD_COLS} FROM custom_field WHERE id = ? AND deleted_at IS NULL`, id);
  return row ? withDetails(db, [row])[0] : undefined;
}

function keyTaken(db: DatabaseSync, key: string, exceptId = ""): boolean {
  return !!one(db, "SELECT 1 FROM custom_field WHERE placeholder_key = ? AND deleted_at IS NULL AND id <> ?", key, exceptId);
}

function resolveKey(db: DatabaseSync, name: string, given: string | null | undefined, exceptId?: string): string {
  const explicit = optionalText(given)?.replace(/^\{\{|\}\}$/g, "");
  if (explicit) {
    if (!isValidPlaceholderKey(explicit)) {
      throw new ValidationError("Chave reservada inválida: use letras minúsculas, números e _ (começando por letra).");
    }
    if (keyTaken(db, explicit, exceptId)) throw new ValidationError(`A chave {{${explicit}}} já está em uso.`);
    return explicit;
  }
  let base = placeholderKeyFromName(name);
  if (!/^[a-z]/.test(base)) base = `campo_${base}`.replace(/_+$/, "");
  base = base.slice(0, 55);
  let key = base;
  for (let n = 2; keyTaken(db, key, exceptId); n++) key = `${base}_${n}`;
  return key;
}

function checkPipelines(db: DatabaseSync, entity: CustomFieldEntity, pipelineIds: string[]): void {
  if (pipelineIds.length === 0) return;
  if (!PIPELINE_ENTITIES.includes(entity)) throw new ValidationError("Só campos de negócio, ticket ou projeto podem ser restritos a funis.");
  for (const id of pipelineIds) {
    const p = one<{ type: string }>(db, "SELECT type FROM pipeline WHERE id = ? AND deleted_at IS NULL", id);
    if (!p) throw new ValidationError("Funil não encontrado.");
    if (p.type !== PIPELINE_TYPE_BY_ENTITY[entity]) throw new ValidationError("O funil escolhido é de outro tipo.");
  }
}

function syncOptions(db: DatabaseSync, ctx: DbContext, fieldId: string, options: NonNullable<CustomFieldInput["options"]>): void {
  const current = many<{ id: string }>(db, "SELECT id FROM custom_field_option WHERE field_id = ? AND deleted_at IS NULL", fieldId);
  const keep = new Set(options.filter((o) => o.id).map((o) => o.id!));
  for (const row of current) if (!keep.has(row.id)) softDelete(db, ctx, "custom_field_option", row.id);
  options.forEach((o, i) => {
    const label = requireText(o.label, "Informe o texto de todas as opções da lista.");
    const data = { label, color: o.color ?? null, position: i };
    if (o.id) updateRow(db, ctx, "custom_field_option", o.id, data);
    else insertRow(db, ctx, "custom_field_option", { field_id: fieldId, ...data });
  });
}

function syncPipelines(db: DatabaseSync, ctx: DbContext, fieldId: string, pipelineIds: string[]): void {
  const current = many<{ id: string; pipeline_id: string }>(
    db,
    "SELECT id, pipeline_id FROM custom_field_pipeline WHERE field_id = ? AND deleted_at IS NULL",
    fieldId,
  );
  const wanted = new Set(pipelineIds);
  for (const row of current) {
    if (wanted.has(row.pipeline_id)) wanted.delete(row.pipeline_id);
    else softDelete(db, ctx, "custom_field_pipeline", row.id);
  }
  for (const pipelineId of wanted) insertRow(db, ctx, "custom_field_pipeline", { field_id: fieldId, pipeline_id: pipelineId });
}

const isList = (t: CustomFieldType) => t === "select" || t === "multiselect";

export function createCustomField(db: DatabaseSync, ctx: DbContext, input: CustomFieldInput): string {
  if (!CUSTOM_FIELD_ENTITIES.includes(input.entity)) throw new ValidationError("Entidade inválida.");
  if (!(input.fieldType in CUSTOM_FIELD_TYPE_LABEL)) throw new ValidationError("Tipo de campo inválido.");
  const name = requireText(input.name, "Informe o nome do campo.");
  const options = input.options ?? [];
  if (isList(input.fieldType) && options.length === 0) throw new ValidationError("Cadastre ao menos uma opção para a lista.");
  const pipelineIds = input.pipelineIds ?? [];
  checkPipelines(db, input.entity, pipelineIds);
  return withTransaction(db, () => {
    const last = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM custom_field WHERE entity = ? AND deleted_at IS NULL", input.entity);
    const id = insertRow(db, ctx, "custom_field", {
      entity: input.entity,
      name,
      description: optionalText(input.description),
      field_type: input.fieldType,
      placeholder_key: resolveKey(db, name, input.placeholderKey),
      always_show: input.alwaysShow ? 1 : 0,
      hidden: input.hidden ? 1 : 0,
      required: input.required ? 1 : 0,
      position: (last?.p ?? -1) + 1,
    });
    if (isList(input.fieldType)) syncOptions(db, ctx, id, options);
    syncPipelines(db, ctx, id, pipelineIds);
    return id;
  });
}

/** Entidade e tipo não mudam depois de criados (os valores já gravados dependem deles). */
export function updateCustomField(
  db: DatabaseSync,
  ctx: DbContext,
  id: string,
  patch: Partial<Omit<CustomFieldInput, "entity" | "fieldType">> & { active?: boolean; position?: number },
): void {
  withTransaction(db, () => {
    const field = getCustomField(db, id);
    if (!field) throw new ValidationError("Campo não encontrado.");
    const data: Record<string, string | number | null> = {};
    if (patch.name !== undefined) data.name = requireText(patch.name, "Informe o nome do campo.");
    if (patch.description !== undefined) data.description = optionalText(patch.description);
    if (patch.placeholderKey !== undefined) {
      data.placeholder_key = resolveKey(db, (data.name as string) ?? field.name, patch.placeholderKey, id);
    }
    if (patch.alwaysShow !== undefined) data.always_show = patch.alwaysShow ? 1 : 0;
    if (patch.hidden !== undefined) data.hidden = patch.hidden ? 1 : 0;
    if (patch.required !== undefined) data.required = patch.required ? 1 : 0;
    if (patch.active !== undefined) data.active = patch.active ? 1 : 0;
    if (patch.position !== undefined) data.position = patch.position;
    updateRow(db, ctx, "custom_field", id, data);
    if (patch.options !== undefined) {
      if (!isList(field.field_type)) throw new ValidationError("Só campos de lista têm opções.");
      if (patch.options.length === 0) throw new ValidationError("Cadastre ao menos uma opção para a lista.");
      syncOptions(db, ctx, id, patch.options);
    }
    if (patch.pipelineIds !== undefined) {
      checkPipelines(db, field.entity, patch.pipelineIds);
      syncPipelines(db, ctx, id, patch.pipelineIds);
    }
  });
}

export function deleteCustomField(db: DatabaseSync, ctx: DbContext, id: string): void {
  softDelete(db, ctx, "custom_field", id);
}

// ---------- Valores ----------

export type CustomValue = string | number | boolean | string[] | null;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Converte o valor recebido da tela para o texto gravado (null = vazio). */
function encodeValue(db: DatabaseSync, field: CustomField, value: CustomValue): string | null {
  const label = `Campo "${field.name}"`;
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  switch (field.field_type) {
    case "text":
    case "textarea":
    case "url":
      return optionalText(String(value));
    case "email":
      return normalizeEmail(String(value));
    case "phone":
      return normalizePhone(String(value));
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      if (!Number.isFinite(n)) throw new ValidationError(`${label}: número inválido.`);
      return String(n);
    }
    case "money":
      if (typeof value !== "number" || !Number.isInteger(value)) throw new ValidationError(`${label}: valor inválido.`);
      return String(value);
    case "date":
      if (typeof value !== "string" || !DATE_RE.test(value)) throw new ValidationError(`${label}: data inválida.`);
      return value;
    case "datetime": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new ValidationError(`${label}: data inválida.`);
      return d.toISOString();
    }
    case "boolean":
      return value === true || value === "1" || value === 1 ? "1" : "0";
    case "select": {
      if (!field.options.some((o) => o.id === value)) throw new ValidationError(`${label}: opção inválida.`);
      return String(value);
    }
    case "multiselect": {
      const ids = Array.isArray(value) ? value : [String(value)];
      if (!ids.every((id) => field.options.some((o) => o.id === id))) throw new ValidationError(`${label}: opção inválida.`);
      return JSON.stringify([...new Set(ids)]);
    }
    case "user":
    case "person":
    case "organization": {
      const table = field.field_type === "user" ? "app_user" : field.field_type;
      if (!one(db, `SELECT 1 FROM ${table} WHERE id = ? AND deleted_at IS NULL`, String(value))) {
        throw new ValidationError(`${label}: registro não encontrado.`);
      }
      return String(value);
    }
  }
}

function decodeValue(field: CustomField, raw: string): CustomValue {
  switch (field.field_type) {
    case "number":
    case "money":
      return Number(raw);
    case "boolean":
      return raw === "1";
    case "multiselect":
      return JSON.parse(raw) as string[];
    default:
      return raw;
  }
}

/** Valores do registro, por id do campo. */
export function getCustomValues(db: DatabaseSync, entityId: string): Record<string, CustomValue> {
  const rows = many<{ field_id: string; value: string }>(
    db,
    `SELECT v.field_id, v.value FROM custom_field_value v
     JOIN custom_field f ON f.id = v.field_id AND f.deleted_at IS NULL
     WHERE v.entity_id = ? AND v.deleted_at IS NULL AND v.value IS NOT NULL`,
    entityId,
  );
  const out: Record<string, CustomValue> = {};
  for (const r of rows) {
    const field = getCustomField(db, r.field_id)!;
    out[r.field_id] = decodeValue(field, r.value);
  }
  return out;
}

/** Grava os valores informados (só os campos presentes em `values`). Com
 * `checkRequired`, confere os obrigatórios visíveis que valem para o registro. */
export function setCustomValues(
  db: DatabaseSync,
  ctx: DbContext,
  entity: CustomFieldEntity,
  entityId: string,
  values: Record<string, CustomValue>,
  opts: { pipelineId?: string; checkRequired?: boolean } = {},
): void {
  withTransaction(db, () => {
    const applicable = listCustomFields(db, entity, { pipelineId: opts.pipelineId });
    const byId = new Map(applicable.map((f) => [f.id, f]));
    for (const [fieldId, value] of Object.entries(values)) {
      const field = byId.get(fieldId);
      if (!field) throw new ValidationError("Campo personalizado não encontrado para este cadastro.");
      const encoded = encodeValue(db, field, value);
      const existing = one<{ id: string }>(
        db,
        "SELECT id FROM custom_field_value WHERE field_id = ? AND entity_id = ? AND deleted_at IS NULL",
        fieldId,
        entityId,
      );
      if (encoded === null) {
        if (existing) softDelete(db, ctx, "custom_field_value", existing.id);
      } else if (existing) {
        updateRow(db, ctx, "custom_field_value", existing.id, { value: encoded });
      } else {
        insertRow(db, ctx, "custom_field_value", { field_id: fieldId, entity_id: entityId, value: encoded });
      }
    }
    if (opts.checkRequired) {
      const filled = getCustomValues(db, entityId);
      const missing = applicable.filter((f) => f.required && !f.hidden && filled[f.id] === undefined);
      if (missing.length > 0) {
        throw new ValidationError(`Preencha os campos obrigatórios: ${missing.map((f) => f.name).join(", ")}.`);
      }
    }
  });
}

/** Quantos registros têm valor neste campo (aviso antes de excluir). */
export function customFieldUsage(db: DatabaseSync, id: string): number {
  return one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM custom_field_value WHERE field_id = ? AND deleted_at IS NULL AND value IS NOT NULL", id)?.n ?? 0;
}

/** Reordena os campos de uma entidade na ordem recebida. */
export function reorderCustomFields(db: DatabaseSync, ctx: DbContext, ids: string[]): void {
  withTransaction(db, () => ids.forEach((id, i) => updateRow(db, ctx, "custom_field", id, { position: i })));
}
