// Importação em lote (planilha Excel/CSV) de contatos e organizações. A tela
// lê o arquivo e mapeia as colunas; aqui cada linha é validada e gravada.
// Duplicados (mesmo e-mail/celular do contato, mesmo CNPJ/nome da
// organização) são ignorados e informados no resumo.
import { cnpjDigits } from "../lib/validate";
import { createOrganization, createPerson, findDuplicatePersons, findOrganizationByCnpj, linkPersonOrganization, type OrganizationInput, type PersonInput } from "./contacts";
import { listCustomFields, type CustomValue } from "./customFields";
import type { DbContext } from "./repo";
import { one, type DatabaseSync } from "./sql";
import { errorText } from "../lib/errors";

export interface ImportSummary {
  created: number;
  skipped: { row: number; reason: string }[];
  errors: { row: number; message: string }[];
}

type CustomByName = Record<string, string>;

function customValuesByName(db: DatabaseSync, entity: "person" | "organization", byName: CustomByName | undefined): Record<string, CustomValue> {
  if (!byName) return {};
  const fields = listCustomFields(db, entity);
  const out: Record<string, CustomValue> = {};
  for (const [name, value] of Object.entries(byName)) {
    const field = fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!field || value === "") continue;
    if (field.field_type === "select") {
      const opt = field.options.find((o) => o.label.toLowerCase() === value.toLowerCase());
      if (opt) out[field.id] = opt.id;
    } else out[field.id] = value;
  }
  return out;
}

function organizationByName(db: DatabaseSync, name: string): string | undefined {
  return one<{ id: string }>(db, "SELECT id FROM organization WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL", name.trim())?.id;
}

export interface PersonImportRow extends Omit<PersonInput, "organizationIds" | "customValues" | "tagIds"> {
  organizationName?: string;
  customByName?: CustomByName;
}

export function importPersons(db: DatabaseSync, ctx: DbContext, rows: PersonImportRow[]): ImportSummary {
  const summary: ImportSummary = { created: 0, skipped: [], errors: [] };
  rows.forEach((row, i) => {
    const line = i + 2; // linha 1 = cabeçalho da planilha
    try {
      const dup = findDuplicatePersons(db, { email: row.email, phone: row.phone, phoneCountry: row.phoneCountry });
      if (dup.length) {
        summary.skipped.push({ row: line, reason: `já existe: ${dup[0]!.name}` });
        return;
      }
      const { organizationName, customByName, ...input } = row;
      const id = createPerson(db, ctx, { ...input, customValues: customValuesByName(db, "person", customByName) });
      if (organizationName?.trim()) {
        const orgId = organizationByName(db, organizationName) ?? createOrganization(db, ctx, { name: organizationName.trim() });
        linkPersonOrganization(db, ctx, id, orgId);
      }
      summary.created++;
    } catch (e) {
      summary.errors.push({ row: line, message: errorText(e) });
    }
  });
  return summary;
}

export interface OrganizationImportRow extends Omit<OrganizationInput, "personIds" | "customValues" | "tagIds"> {
  customByName?: CustomByName;
}

export function importOrganizations(db: DatabaseSync, ctx: DbContext, rows: OrganizationImportRow[]): ImportSummary {
  const summary: ImportSummary = { created: 0, skipped: [], errors: [] };
  rows.forEach((row, i) => {
    const line = i + 2;
    try {
      const cnpj = cnpjDigits(row.cnpj);
      const dup = (cnpj && findOrganizationByCnpj(db, cnpj)) || (row.name && organizationByName(db, row.name) ? { name: row.name } : undefined);
      if (dup) {
        summary.skipped.push({ row: line, reason: `já existe: ${dup.name}` });
        return;
      }
      const { customByName, ...input } = row;
      createOrganization(db, ctx, { ...input, customValues: customValuesByName(db, "organization", customByName) });
      summary.created++;
    } catch (e) {
      summary.errors.push({ row: line, message: errorText(e) });
    }
  });
  return summary;
}
