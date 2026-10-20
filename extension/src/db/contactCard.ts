// Ficha de contato/organização para a Gestão Financeira (spec 13, paridade de
// cadastros): tudo o que vai para "Clientes e fornecedores" de lá.
//
// PARIDADE: cada coluna de `person` e `organization` está em PERSON_COLUMNS /
// ORGANIZATION_COLUMNS — ou com o campo da ficha (ContactCard) para onde vai,
// ou com o motivo de não ir. Coluna nova sem decisão = o teste
// tests/paridadeContatos.test.ts falha. Campo novo na ficha: mude protocol.ts
// nos DOIS repositórios (ver CLAUDE.md).
import type { ContactCard, ContactCardField } from "../lib/finance/protocol";
import { formatCustomRaw } from "./cardHistory";
import type { CustomFieldEntity } from "./customFields";
import { many, one, type DatabaseSync } from "./sql";

type Excluded = `não vai: ${string}`;

const COMMON: Record<string, ContactCardField | Excluded> = {
  id: "crmRef",
  workspace_id: "não vai: controle interno do CRM",
  name: "name",
  email: "email",
  phone: "phone",
  phone_country: "phoneCountry",
  owner_id: "não vai: responsável é do CRM (vendas)",
  created_at: "não vai: controle interno",
  created_by: "não vai: controle interno",
  updated_at: "não vai: controle interno",
  updated_by: "não vai: controle interno",
  deleted_at: "não vai: excluído no CRM não apaga o cadastro financeiro (lançamentos continuam)",
  version: "não vai: controle interno",
};

/** Colunas de `person` → campo da ficha (ou por que não vai). Tags, campos personalizados e empresa vêm de outras tabelas. */
export const PERSON_COLUMNS: Record<string, ContactCardField | Excluded> = {
  ...COMMON,
  cpf: "document",
  notes: "notes",
  avatar_id: "não vai: foto não serve ao financeiro (decisão do usuário)",
  is_private: "não vai: contato privado só vai quando usado em lançamento ou enviado de propósito",
};

/** Colunas de `organization` → campo da ficha (ou por que não vai). */
export const ORGANIZATION_COLUMNS: Record<string, ContactCardField | Excluded> = {
  ...COMMON,
  legal_name: "legalName",
  cnpj: "document",
  website: "website",
  segment: "segment",
  cep: "address.cep",
  street: "address.street",
  number: "address.number",
  complement: "address.complement",
  district: "address.district",
  city: "address.city",
  state: "address.state",
  country: "address.country",
  description: "notes",
  logo_id: "não vai: logo não serve ao financeiro (decisão do usuário)",
  cnpj_data: "não vai: o que importa da Receita já está nos campos (razão social, endereço)",
};

/** Campos que vêm de outras tabelas (vínculos), para o teste de paridade. */
export const RELATED_FIELDS: ContactCardField[] = ["kind", "tags", "customFields", "company.crmRef", "company.name"];

/** Campos personalizados visíveis e preenchidos, já formatados ("Cargo" → "Diretora"). */
function customFieldTexts(db: DatabaseSync, entity: CustomFieldEntity, id: string): { label: string; value: string }[] {
  const rows = many<{ name: string; field_type: string; value: string | null }>(
    db,
    `SELECT f.name, f.field_type, v.value FROM custom_field_value v JOIN custom_field f ON f.id = v.field_id
     WHERE v.entity_id = ? AND v.deleted_at IS NULL AND f.deleted_at IS NULL AND f.active = 1 AND f.hidden = 0 AND f.entity = ?
     ORDER BY f.position`,
    id,
    entity,
  ).filter((r) => r.value != null && r.value !== "" && r.value !== "[]");
  if (!rows.length) return [];
  const types = new Set(rows.map((r) => r.field_type));
  const lookup = (need: boolean, sql: string) => (need ? new Map(many<{ id: string; v: string }>(db, sql).map((r) => [r.id, r.v])) : new Map<string, string>());
  const names = {
    options: lookup(types.has("select") || types.has("multiselect"), "SELECT id, label AS v FROM custom_field_option"),
    users: lookup(types.has("user"), "SELECT id, name AS v FROM app_user"),
    persons: lookup(types.has("person"), "SELECT id, name AS v FROM person"),
    orgs: lookup(types.has("organization"), "SELECT id, name AS v FROM organization"),
    documents: lookup(types.has("document"), "SELECT id, name AS v FROM document"),
  };
  return rows.map((r) => ({ label: r.name, value: formatCustomRaw(r.value, r.field_type, names) })).filter((x) => x.value && x.value !== "vazio");
}

const tagNames = (db: DatabaseSync, id: string) =>
  many<{ name: string }>(
    db,
    `SELECT t.name FROM entity_tag et JOIN tag t ON t.id = et.tag_id AND t.deleted_at IS NULL
     WHERE et.entity_id = ? AND et.deleted_at IS NULL ORDER BY t.name COLLATE NOCASE`,
    id,
  ).map((t) => t.name);

export function personCard(db: DatabaseSync, id: string): ContactCard | null {
  const p = one<{ id: string; name: string; cpf: string | null; email: string | null; phone: string | null; phone_country: string | null; notes: string | null }>(
    db,
    "SELECT id, name, cpf, email, phone, phone_country, notes FROM person WHERE id = ? AND deleted_at IS NULL",
    id,
  );
  if (!p) return null;
  const company = one<{ id: string; name: string }>(
    db,
    `SELECT o.id, o.name FROM person_organization po JOIN organization o ON o.id = po.organization_id AND o.deleted_at IS NULL
     WHERE po.person_id = ? AND po.deleted_at IS NULL ORDER BY po.is_primary DESC, po.created_at LIMIT 1`,
    id,
  );
  return {
    crmRef: `person:${p.id}`,
    kind: "PF",
    name: p.name,
    document: p.cpf,
    email: p.email,
    phone: p.phone,
    phoneCountry: p.phone_country,
    company: company ? { crmRef: `organization:${company.id}`, name: company.name } : null,
    notes: p.notes,
    tags: tagNames(db, id),
    customFields: customFieldTexts(db, "person", id),
  };
}

export function organizationCard(db: DatabaseSync, id: string): ContactCard | null {
  const o = one<Record<string, string | null> & { id: string; name: string }>(
    db,
    `SELECT id, name, legal_name, cnpj, website, segment, phone, phone_country, email, cep, street, number, complement, district, city, state, country, description
     FROM organization WHERE id = ? AND deleted_at IS NULL`,
    id,
  );
  if (!o) return null;
  return {
    crmRef: `organization:${o.id}`,
    kind: "PJ",
    name: o.name,
    document: o.cnpj,
    email: o.email,
    phone: o.phone,
    phoneCountry: o.phone_country,
    legalName: o.legal_name,
    website: o.website,
    segment: o.segment,
    address: { cep: o.cep, street: o.street, number: o.number, complement: o.complement, district: o.district, city: o.city, state: o.state, country: o.country },
    notes: o.description,
    tags: tagNames(db, id),
    customFields: customFieldTexts(db, "organization", id),
  };
}

/** Ficha pelo vínculo ("person:<id>" / "organization:<id>"); null se não existe mais. */
export function contactCardFor(db: DatabaseSync, crmRef: string): ContactCard | null {
  const [kind, id] = crmRef.split(":");
  if (!id) return null;
  return kind === "person" ? personCard(db, id) : kind === "organization" ? organizationCard(db, id) : null;
}
