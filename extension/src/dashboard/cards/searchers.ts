// Buscas usadas nos campos Contato / Organização dos formulários.
import { call } from "../../rpc/client";
import type { ComboItem } from "../ui/Combobox";

export async function searchPersons(text: string): Promise<ComboItem[]> {
  const list = await call("persons.list", { search: text, limit: 10 });
  return list.map((p) => ({ id: p.id, label: p.name, sublabel: p.phone ?? p.email ?? p.primary_organization_name }));
}

/**
 * Criação rápida pelo campo de busca: se já existe nome parecido, pergunta
 * se é para usar o existente (anti-duplicidade).
 */
function existingIfSimilar(name: string, list: { id: string; name: string; score: number; details: string[] }[]): ComboItem | null {
  const top = list[0];
  if (!top) return null;
  const more = list.length > 1 ? `\n(e mais ${list.length - 1} parecido${list.length > 2 ? "s" : ""})` : "";
  const detail = [`${top.score}% parecido`, ...top.details].join(" · ");
  const msg = `Possível duplicidade: já existe "${top.name}" (${detail}).${more}\n\nOK = usar o cadastro existente\nCancelar = criar "${name}" mesmo assim`;
  return window.confirm(msg) ? { id: top.id, label: top.name } : null;
}

export async function createPersonQuick(name: string): Promise<ComboItem> {
  const existing = existingIfSimilar(name, await call("similar.persons", { name }));
  if (existing) return existing;
  const id = await call("persons.create", { name });
  return { id, label: name };
}

export async function searchOrganizations(text: string): Promise<ComboItem[]> {
  const list = await call("organizations.list", { search: text, limit: 10 });
  return list.map((o) => ({ id: o.id, label: o.name, sublabel: o.city }));
}

export async function createOrganizationQuick(name: string): Promise<ComboItem> {
  const existing = existingIfSimilar(name, await call("similar.organizations", { name }));
  if (existing) return existing;
  const id = await call("organizations.create", { name });
  return { id, label: name };
}
