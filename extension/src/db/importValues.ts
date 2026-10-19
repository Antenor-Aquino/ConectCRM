// Conversões comuns às importações (planilha e integrações): texto → valor
// de campo personalizado, nomes → tags (criadas quando não existem) e busca
// de registros pelo nome.
import { importKey, parseImportDate, parseImportDay, parseMoneyCents, parseNumber, parseYesNo, splitList } from "../lib/importParse";
import { ValidationError } from "../lib/validate";
import type { CustomField, CustomValue } from "./customFields";
import type { DbContext } from "./repo";
import { one, type DatabaseSync } from "./sql";
import { createTag, listTags, type TagEntity } from "./tags";

/** Registro ativo com este nome (sem diferença de maiúsculas). */
export const idByName = (db: DatabaseSync, table: "person" | "organization" | "app_user", name: string) =>
  one<{ id: string }>(db, `SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL`, name.trim())?.id;

function optionId(field: CustomField, raw: string): string {
  if (field.options.some((o) => o.id === raw)) return raw;
  const opt = field.options.find((o) => importKey(o.label) === importKey(raw));
  if (!opt) throw new ValidationError(`Campo "${field.name}": a opção "${raw}" não existe.`);
  return opt.id;
}

/** Texto importado → valor do campo personalizado (opções: id já escolhido no de-para ou o rótulo). */
export function customValueFromText(db: DatabaseSync, field: CustomField, raw: string | string[]): CustomValue {
  const label = `Campo "${field.name}"`;
  const text = Array.isArray(raw) ? raw.join(";") : raw.trim();
  if (!text) return null;
  switch (field.field_type) {
    case "number": {
      const n = parseNumber(text);
      if (n === null) throw new ValidationError(`${label}: número "${text}" não reconhecido.`);
      return n;
    }
    case "money":
      return parseMoneyCents(text, label);
    case "date":
      return parseImportDay(text, label);
    case "datetime":
      return parseImportDate(text, label);
    case "boolean":
      return parseYesNo(text);
    case "select":
      return optionId(field, Array.isArray(raw) ? raw[0]! : text);
    case "multiselect":
      return (Array.isArray(raw) ? raw : splitList(text)).map((v) => optionId(field, v));
    case "user": {
      const id =
        idByName(db, "app_user", text) ?? one<{ id: string }>(db, "SELECT id FROM app_user WHERE email = ? COLLATE NOCASE AND deleted_at IS NULL", text)?.id;
      if (!id) throw new ValidationError(`${label}: usuário "${text}" não encontrado.`);
      return id;
    }
    case "person":
    case "organization": {
      const id = idByName(db, field.field_type, text);
      if (!id) throw new ValidationError(`${label}: "${text}" não encontrado.`);
      return id;
    }
    default:
      return text;
  }
}

/** Nomes → ids das tags do tipo (criando as que faltam); undefined se não há nomes.
 * `cache` (nome normalizado → id) evita reler as tags a cada linha. */
export function tagIdsByName(db: DatabaseSync, ctx: DbContext, entity: TagEntity, names: string[], cache: Map<string, string>): string[] | undefined {
  if (!names.length) return undefined;
  if (!cache.size) for (const t of listTags(db, entity, { includeInactive: true })) cache.set(importKey(t.name), t.id);
  return [
    ...new Set(
      names.map((n) => {
        const key = importKey(n);
        let id = cache.get(key);
        if (!id) {
          id = createTag(db, ctx, { entity, name: n.trim() });
          cache.set(key, id);
        }
        return id;
      }),
    ),
  ];
}
