// Buscas usadas nos campos Contato / Organização dos formulários.
import { ORG_TYPE_LABEL } from "../../lib/orgType";
import { call } from "../../rpc/client";
import type { ComboItem } from "../ui/Combobox";
import { withExtra } from "../../lib/nameExtra";
import { cnpjToOrganizationFields, formatCnpj, lookupCnpj } from "../../lib/cnpj";
import { cnpjDigits, isValidCnpj } from "../../lib/validate";

export async function searchPersons(text: string): Promise<ComboItem[]> {
  const list = await call("persons.list", { search: text, limit: 10 });
  return list.map((p) => ({ id: p.id, label: withExtra(p.name, p.name_ext), sublabel: p.phone ?? p.email ?? p.primary_organization_name }));
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
  return list.map((o) => ({ id: o.id, label: withExtra(o.name, o.name_ext), sublabel: [o.org_type ? ORG_TYPE_LABEL[o.org_type] : null, o.city].filter(Boolean).join(" · ") || null }));
}

/** O texto digitado é um CNPJ (14 dígitos)? */
export const looksLikeCnpj = (text: string) => /^[\d.\-/\s]+$/.test(text.trim()) && cnpjDigits(text).length === 14;

/** "Criar" ou, com CNPJ digitado, "Criar pela Receita". */
export const organizationCreateLabel = (text: string) => (looksLikeCnpj(text) ? "Criar pela Receita (CNPJ)" : "Criar organização");

/**
 * CNPJ digitado na busca: usa a organização que já tem esse CNPJ ou cria uma
 * nova com os dados da Receita (nome, razão social, endereço, telefone…).
 * Sem resposta da Receita, cria só com o CNPJ (o cadastro consulta de novo ao abrir).
 */
export async function createOrganizationFromCnpj(text: string, lookup: typeof lookupCnpj = lookupCnpj): Promise<ComboItem> {
  const digits = cnpjDigits(text);
  if (!isValidCnpj(digits)) throw new Error(`CNPJ inválido (${formatCnpj(digits)}). Confira os 14 dígitos.`);
  const dup = await call("organizations.findByCnpj", { cnpj: digits });
  if (dup) return { id: dup.id, label: dup.name };
  const r = await lookup(digits);
  if (!r.ok) {
    const id = await call("organizations.create", { name: `CNPJ ${formatCnpj(digits)}`, cnpj: digits });
    return { id, label: `CNPJ ${formatCnpj(digits)}`, sublabel: "Receita sem resposta: complete o cadastro" };
  }
  const f = cnpjToOrganizationFields(r.data);
  const name = f.name || f.legalName || `CNPJ ${formatCnpj(digits)}`;
  const id = await call("organizations.create", {
    name,
    cnpj: digits,
    legalName: f.legalName || null,
    segment: f.segment || null,
    phone: f.phone || null,
    email: f.email || null,
    cep: f.cep || null,
    street: f.street || null,
    number: f.number || null,
    complement: f.complement || null,
    district: f.district || null,
    city: f.city || null,
    state: f.state || null,
    country: "Brasil",
    cnpjData: r.data,
  });
  return { id, label: name, sublabel: [f.city, f.state].filter(Boolean).join("/") || null };
}

export async function createOrganizationQuick(name: string): Promise<ComboItem> {
  if (looksLikeCnpj(name)) return createOrganizationFromCnpj(name);
  const existing = existingIfSimilar(name, await call("similar.organizations", { name }));
  if (existing) return existing;
  const id = await call("organizations.create", { name });
  return { id, label: name };
}
