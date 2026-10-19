// Campos personalizados agrupados por categoria (formulários e telas).
import type { CustomField } from "../db/customFields";

/** Campos separados por categoria: os sem categoria primeiro, depois as categorias na ordem definida. */
export function fieldGroups(fields: CustomField[]): { id: string | null; name: string | null; fields: CustomField[] }[] {
  const out = new Map<string, { id: string | null; name: string | null; position: number; fields: CustomField[] }>();
  for (const f of fields) {
    const id = f.group_id && f.group_name ? f.group_id : null;
    const key = id ?? "";
    if (!out.has(key)) out.set(key, { id, name: id ? f.group_name : null, position: id ? (f.group_position ?? 0) : -Infinity, fields: [] });
    out.get(key)!.fields.push(f);
  }
  return [...out.values()].sort((a, b) => a.position - b.position).map(({ position: _p, ...g }) => g);
}
