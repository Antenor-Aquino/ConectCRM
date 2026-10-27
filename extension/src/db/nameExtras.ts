// Campos personalizados exibidos junto com o nome (até 2 por entidade, marcados
// no cadastro do campo): "Maria José - Diretora", "AEB Sistemas - Saúde".
// As listas pedem os complementos de todos os registros da tela de uma vez.
import { formatCustomRaw } from "./cardHistory";
import type { CustomFieldEntity } from "./customFields";
import { many, type DatabaseSync } from "./sql";

const MAX_LEN = 40;

/** Complemento de cada registro ("Diretora · Compras"); quem não tem valor fica de fora. */
export function nameExtras(db: DatabaseSync, entity: CustomFieldEntity, ids: (string | null | undefined)[]): Map<string, string> {
  const out = new Map<string, string>();
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return out;
  const fields = many<{ id: string; name: string; field_type: string }>(
    db,
    `SELECT id, name, field_type FROM custom_field WHERE entity = ? AND show_with_name = 1 AND active = 1 AND hidden = 0 AND deleted_at IS NULL
     ORDER BY position LIMIT 2`,
    entity,
  );
  if (!fields.length) return out;
  const values = new Map<string, Map<string, string>>(); // entidade → campo → valor
  for (let i = 0; i < wanted.length; i += 500) {
    const part = wanted.slice(i, i + 500);
    for (const v of many<{ entity_id: string; field_id: string; value: string | null }>(
      db,
      `SELECT entity_id, field_id, value FROM custom_field_value WHERE deleted_at IS NULL
       AND field_id IN (${fields.map(() => "?").join(", ")}) AND entity_id IN (${part.map(() => "?").join(", ")})`,
      ...fields.map((f) => f.id),
      ...part,
    )) {
      if (v.value == null || v.value === "" || v.value === "[]") continue;
      const m = values.get(v.entity_id) ?? new Map<string, string>();
      m.set(v.field_id, v.value);
      values.set(v.entity_id, m);
    }
  }
  if (!values.size) return out;
  const types = new Set(fields.map((f) => f.field_type));
  const lookup = (need: boolean, sql: string) => (need ? new Map(many<{ id: string; v: string }>(db, sql).map((r) => [r.id, r.v])) : new Map<string, string>());
  const names = {
    options: lookup(types.has("select") || types.has("multiselect"), "SELECT id, label AS v FROM custom_field_option"),
    users: lookup(types.has("user"), "SELECT id, name AS v FROM app_user"),
    persons: lookup(types.has("person"), "SELECT id, name AS v FROM person"),
    orgs: lookup(types.has("organization"), "SELECT id, name AS v FROM organization"),
    documents: lookup(types.has("document"), "SELECT id, name AS v FROM document"),
  };
  for (const [id, m] of values) {
    const parts = fields
      .filter((f) => m.has(f.id))
      .map((f) => {
        const raw = m.get(f.id)!;
        // Sim/Não sozinho não diz nada: marcado, entra o nome do campo ("Decisor"); desmarcado, nada.
        if (f.field_type === "boolean") return raw === "1" ? f.name : "";
        const t = formatCustomRaw(raw, f.field_type, names).replace(/\s+/g, " ").trim();
        return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN - 1)}…` : t;
      })
      .filter((t) => t && t !== "vazio");
    if (parts.length) out.set(id, parts.join(" · "));
  }
  return out;
}

export { withExtra } from "../lib/nameExtra";

/** Acrescenta `<campo>_ext` (complemento) em cada linha. */
export function attachExtras<T extends object, K extends string>(
  db: DatabaseSync,
  entity: CustomFieldEntity,
  rows: T[],
  idKey: keyof T & string,
  extKey: K,
): (T & Record<K, string | null>)[] {
  const id = (r: T) => (r as Record<string, unknown>)[idKey] as string | null;
  const ex = nameExtras(db, entity, rows.map(id));
  return rows.map((r) => ({ ...r, [extKey]: ex.get(id(r) ?? "") ?? null }) as T & Record<K, string | null>);
}
