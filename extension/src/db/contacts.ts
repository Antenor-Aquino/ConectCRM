// Contatos (spec 03) e organizações (spec 04), com o vínculo entre eles:
// um contato pode ter várias organizações e a primeira vira a principal.
import { normalizeCnpj, normalizeEmail, normalizePhone, optionalText, requireText, ValidationError } from "../lib/validate";
import { getCustomValues, setCustomValues, type CustomValue } from "./customFields";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { getEntityTags, setEntityTags, type Tag } from "./tags";
import { getUser, type Viewer } from "./users";

// ---------- Vínculo contato ↔ organização ----------

export function linkPersonOrganization(db: DatabaseSync, ctx: DbContext, personId: string, organizationId: string): void {
  withTransaction(db, () => {
    if (!getRow(db, "person", personId)) throw new ValidationError("Contato não encontrado.");
    if (!getRow(db, "organization", organizationId)) throw new ValidationError("Organização não encontrada.");
    const exists = one(
      db,
      "SELECT 1 FROM person_organization WHERE person_id = ? AND organization_id = ? AND deleted_at IS NULL",
      personId,
      organizationId,
    );
    if (exists) return;
    const hasAny = one(db, "SELECT 1 FROM person_organization WHERE person_id = ? AND deleted_at IS NULL", personId);
    // "Se for a primeira organização do contato, o vínculo vira o principal." (spec 04)
    insertRow(db, ctx, "person_organization", { person_id: personId, organization_id: organizationId, is_primary: hasAny ? 0 : 1 });
  });
}

export function unlinkPersonOrganization(db: DatabaseSync, ctx: DbContext, personId: string, organizationId: string): void {
  withTransaction(db, () => {
    const link = one<{ id: string; is_primary: number }>(
      db,
      "SELECT id, is_primary FROM person_organization WHERE person_id = ? AND organization_id = ? AND deleted_at IS NULL",
      personId,
      organizationId,
    );
    if (!link) return;
    softDelete(db, ctx, "person_organization", link.id);
    if (link.is_primary) {
      const next = one<{ id: string }>(
        db,
        "SELECT id FROM person_organization WHERE person_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
        personId,
      );
      if (next) updateRow(db, ctx, "person_organization", next.id, { is_primary: 1 });
    }
  });
}

export function setPrimaryOrganization(db: DatabaseSync, ctx: DbContext, personId: string, organizationId: string): void {
  withTransaction(db, () => {
    const links = many<{ id: string; organization_id: string }>(
      db,
      "SELECT id, organization_id FROM person_organization WHERE person_id = ? AND deleted_at IS NULL",
      personId,
    );
    if (!links.some((l) => l.organization_id === organizationId)) throw new ValidationError("A organização não está vinculada a este contato.");
    for (const l of links) updateRow(db, ctx, "person_organization", l.id, { is_primary: l.organization_id === organizationId ? 1 : 0 });
  });
}

function syncLinks(db: DatabaseSync, ctx: DbContext, side: "person" | "organization", id: string, otherIds: string[]): void {
  const col = side === "person" ? "organization_id" : "person_id";
  const current = many<{ other: string }>(
    db,
    `SELECT ${col} AS other FROM person_organization WHERE ${side}_id = ? AND deleted_at IS NULL`,
    id,
  ).map((r) => r.other);
  const pair = (other: string): [string, string] => (side === "person" ? [id, other] : [other, id]);
  for (const other of current) if (!otherIds.includes(other)) unlinkPersonOrganization(db, ctx, ...pair(other));
  for (const other of otherIds) if (!current.includes(other)) linkPersonOrganization(db, ctx, ...pair(other));
}

function checkOwner(db: DatabaseSync, ownerId: string | null | undefined): string | null {
  if (!ownerId) return null;
  if (!getUser(db, ownerId)) throw new ValidationError("Responsável não encontrado.");
  return ownerId;
}

// ---------- Contatos ----------

export interface PersonInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  phoneCountry?: string | null;
  notes?: string | null;
  ownerId?: string | null;
  isPrivate?: boolean;
  googleSync?: boolean;
  organizationIds?: string[];
  tagIds?: string[];
  customValues?: Record<string, CustomValue>;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  phone_country: string | null;
  notes: string | null;
  avatar_id: string | null;
  owner_id: string | null;
  is_private: number;
  google_sync: number;
  created_by: string | null;
  version: number;
}

export interface PersonDetail extends Person {
  organizations: { id: string; name: string; is_primary: number }[];
  tags: Tag[];
  customValues: Record<string, CustomValue>;
}

export interface PersonListItem extends Person {
  primary_organization_name: string | null;
}

/** Contato privado só aparece para o responsável, quem criou e administradores (spec 03). */
function personVisibility(viewer: Viewer | null | undefined, alias = "p"): { sql: string; params: SqlValue[] } {
  if (!viewer || viewer.role === "admin") return { sql: "", params: [] };
  return {
    sql: ` AND (${alias}.is_private = 0 OR ${alias}.owner_id = ? OR ${alias}.created_by = ?)`,
    params: [viewer.id, viewer.id],
  };
}

const PERSON_COLS = "p.id, p.name, p.email, p.phone, p.phone_country, p.notes, p.avatar_id, p.owner_id, p.is_private, p.google_sync, p.created_by, p.version";

function personData(db: DatabaseSync, input: Partial<PersonInput>, full: boolean): Record<string, SqlValue> {
  const data: Record<string, SqlValue> = {};
  if (full || input.name !== undefined) data.name = requireText(input.name, "Informe o nome do contato.");
  if (full || input.email !== undefined) data.email = normalizeEmail(input.email);
  if (full || input.phone !== undefined || input.phoneCountry !== undefined) {
    const country = input.phoneCountry ?? "BR";
    data.phone = normalizePhone(input.phone, country);
    data.phone_country = data.phone ? country : null;
  }
  if (full || input.notes !== undefined) data.notes = optionalText(input.notes);
  if (full || input.ownerId !== undefined) data.owner_id = checkOwner(db, input.ownerId);
  if (full || input.isPrivate !== undefined) data.is_private = input.isPrivate ? 1 : 0;
  if (full || input.googleSync !== undefined) data.google_sync = input.googleSync ? 1 : 0;
  return data;
}

export function createPerson(db: DatabaseSync, ctx: DbContext, input: PersonInput): string {
  return withTransaction(db, () => {
    const data = personData(db, { ...input, ownerId: input.ownerId === undefined ? ctx.userId : input.ownerId }, true);
    const id = insertRow(db, ctx, "person", data);
    for (const orgId of input.organizationIds ?? []) linkPersonOrganization(db, ctx, id, orgId);
    if (input.tagIds) setEntityTags(db, ctx, "person", id, input.tagIds);
    setCustomValues(db, ctx, "person", id, input.customValues ?? {}, { checkRequired: true });
    return id;
  });
}

export function updatePerson(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<PersonInput>): void {
  withTransaction(db, () => {
    if (!getRow(db, "person", id)) throw new ValidationError("Contato não encontrado.");
    updateRow(db, ctx, "person", id, personData(db, patch, false));
    if (patch.organizationIds) syncLinks(db, ctx, "person", id, patch.organizationIds);
    if (patch.tagIds) setEntityTags(db, ctx, "person", id, patch.tagIds);
    if (patch.customValues) setCustomValues(db, ctx, "person", id, patch.customValues, { checkRequired: true });
  });
}

export function deletePerson(db: DatabaseSync, ctx: DbContext, id: string): void {
  withTransaction(db, () => {
    for (const link of many<{ organization_id: string }>(db, "SELECT organization_id FROM person_organization WHERE person_id = ? AND deleted_at IS NULL", id)) {
      unlinkPersonOrganization(db, ctx, id, link.organization_id);
    }
    softDelete(db, ctx, "person", id);
  });
}

export function getPerson(db: DatabaseSync, id: string, viewer?: Viewer | null): PersonDetail | undefined {
  const vis = personVisibility(viewer);
  const person = one<Person>(db, `SELECT ${PERSON_COLS} FROM person p WHERE p.id = ? AND p.deleted_at IS NULL${vis.sql}`, id, ...vis.params);
  if (!person) return undefined;
  return {
    ...person,
    organizations: many(
      db,
      `SELECT o.id, o.name, po.is_primary FROM person_organization po
       JOIN organization o ON o.id = po.organization_id AND o.deleted_at IS NULL
       WHERE po.person_id = ? AND po.deleted_at IS NULL ORDER BY po.is_primary DESC, o.name COLLATE NOCASE`,
      id,
    ),
    tags: getEntityTags(db, id),
    customValues: getCustomValues(db, id),
  };
}

function like(search: string): string {
  return `%${search.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
}

/** Busca por nome, e-mail ou telefone (mesma busca do campo "Contato" dos formulários). */
export function listPersons(
  db: DatabaseSync,
  opts: { search?: string; ownerId?: string; organizationId?: string; limit?: number; offset?: number; viewer?: Viewer | null } = {},
): PersonListItem[] {
  const where: string[] = ["p.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (opts.search?.trim()) {
    const digits = opts.search.replace(/\D/g, "");
    where.push(`(p.name LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\'${digits.length >= 3 ? " OR p.phone LIKE ?" : ""})`);
    params.push(like(opts.search), like(opts.search));
    if (digits.length >= 3) params.push(`%${digits}%`);
  }
  if (opts.ownerId) {
    where.push("p.owner_id = ?");
    params.push(opts.ownerId);
  }
  if (opts.organizationId) {
    where.push("EXISTS (SELECT 1 FROM person_organization x WHERE x.person_id = p.id AND x.organization_id = ? AND x.deleted_at IS NULL)");
    params.push(opts.organizationId);
  }
  const vis = personVisibility(opts.viewer);
  return many<PersonListItem>(
    db,
    `SELECT ${PERSON_COLS},
       (SELECT o.name FROM person_organization po JOIN organization o ON o.id = po.organization_id AND o.deleted_at IS NULL
        WHERE po.person_id = p.id AND po.is_primary = 1 AND po.deleted_at IS NULL) AS primary_organization_name
     FROM person p WHERE ${where.join(" AND ")}${vis.sql}
     ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...params,
    ...vis.params,
    opts.limit ?? 50,
    opts.offset ?? 0,
  );
}

/** Contatos com o mesmo e-mail ou celular - aviso de duplicidade (spec 03, seção 2). */
export function findDuplicatePersons(
  db: DatabaseSync,
  input: { email?: string | null; phone?: string | null; phoneCountry?: string | null; excludeId?: string },
): { id: string; name: string; match: "email" | "phone" }[] {
  const out: { id: string; name: string; match: "email" | "phone" }[] = [];
  let email: string | null = null;
  let phone: string | null = null;
  try {
    email = normalizeEmail(input.email);
  } catch {
    /* e-mail incompleto enquanto o usuário digita */
  }
  try {
    phone = normalizePhone(input.phone, input.phoneCountry ?? "BR");
  } catch {
    /* idem */
  }
  if (email) {
    for (const r of many<{ id: string; name: string }>(db, "SELECT id, name FROM person WHERE email = ? AND deleted_at IS NULL AND id <> ?", email, input.excludeId ?? "")) {
      out.push({ ...r, match: "email" });
    }
  }
  if (phone) {
    for (const r of many<{ id: string; name: string }>(db, "SELECT id, name FROM person WHERE phone = ? AND deleted_at IS NULL AND id <> ?", phone, input.excludeId ?? "")) {
      out.push({ ...r, match: "phone" });
    }
  }
  return out;
}

/** Organização principal do contato - sugerida ao criar negócio/ticket. */
export function primaryOrganizationId(db: DatabaseSync, personId: string): string | null {
  return (
    one<{ organization_id: string }>(
      db,
      "SELECT organization_id FROM person_organization WHERE person_id = ? AND is_primary = 1 AND deleted_at IS NULL",
      personId,
    )?.organization_id ?? null
  );
}

// ---------- Organizações ----------

export interface OrganizationInput {
  name: string;
  legalName?: string | null;
  cnpj?: string | null;
  website?: string | null;
  segment?: string | null;
  ownerId?: string | null;
  phone?: string | null;
  phoneCountry?: string | null;
  email?: string | null;
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  description?: string | null;
  cnpjData?: unknown;
  personIds?: string[];
  tagIds?: string[];
  customValues?: Record<string, CustomValue>;
}

export interface Organization {
  id: string;
  name: string;
  legal_name: string | null;
  cnpj: string | null;
  website: string | null;
  segment: string | null;
  owner_id: string | null;
  phone: string | null;
  phone_country: string | null;
  email: string | null;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  description: string | null;
  logo_id: string | null;
  version: number;
}

export interface OrganizationDetail extends Organization {
  persons: { id: string; name: string; is_primary: number }[];
  tags: Tag[];
  customValues: Record<string, CustomValue>;
}

const ORG_COLS =
  "id, name, legal_name, cnpj, website, segment, owner_id, phone, phone_country, email, cep, street, number, complement, district, city, state, country, description, logo_id, version";

const ORG_TEXT_FIELDS: [keyof OrganizationInput, string][] = [
  ["legalName", "legal_name"],
  ["website", "website"],
  ["street", "street"],
  ["number", "number"],
  ["complement", "complement"],
  ["district", "district"],
  ["city", "city"],
  ["state", "state"],
  ["country", "country"],
  ["description", "description"],
];

function organizationData(db: DatabaseSync, input: Partial<OrganizationInput>, full: boolean, exceptId?: string): Record<string, SqlValue> {
  const data: Record<string, SqlValue> = {};
  if (full || input.name !== undefined) data.name = requireText(input.name, "Informe o nome da organização.");
  for (const [key, col] of ORG_TEXT_FIELDS) if (full || input[key] !== undefined) data[col] = optionalText(input[key] as string | null);
  if (full || input.segment !== undefined) data.segment = optionalText(input.segment)?.replace(/\s+/g, " ") ?? null;
  if (full || input.cnpj !== undefined) {
    data.cnpj = normalizeCnpj(input.cnpj);
    if (data.cnpj) {
      const dup = findOrganizationByCnpj(db, data.cnpj);
      if (dup && dup.id !== exceptId) throw new ValidationError(`CNPJ já cadastrado em "${dup.name}".`);
    }
  }
  if (full || input.cep !== undefined) data.cep = optionalText(input.cep)?.replace(/\D/g, "") || null;
  if (full || input.email !== undefined) data.email = normalizeEmail(input.email);
  if (full || input.phone !== undefined || input.phoneCountry !== undefined) {
    const country = input.phoneCountry ?? "BR";
    data.phone = normalizePhone(input.phone, country);
    data.phone_country = data.phone ? country : null;
  }
  if (full || input.ownerId !== undefined) data.owner_id = checkOwner(db, input.ownerId);
  if (input.cnpjData !== undefined) data.cnpj_data = input.cnpjData === null ? null : JSON.stringify(input.cnpjData);
  if (full && data.country === null) data.country = "Brasil";
  return data;
}

export function createOrganization(db: DatabaseSync, ctx: DbContext, input: OrganizationInput): string {
  return withTransaction(db, () => {
    const id = insertRow(db, ctx, "organization", organizationData(db, { ...input, ownerId: input.ownerId === undefined ? ctx.userId : input.ownerId }, true));
    for (const personId of input.personIds ?? []) linkPersonOrganization(db, ctx, personId, id);
    if (input.tagIds) setEntityTags(db, ctx, "organization", id, input.tagIds);
    setCustomValues(db, ctx, "organization", id, input.customValues ?? {}, { checkRequired: true });
    return id;
  });
}

export function updateOrganization(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<OrganizationInput>): void {
  withTransaction(db, () => {
    if (!getRow(db, "organization", id)) throw new ValidationError("Organização não encontrada.");
    updateRow(db, ctx, "organization", id, organizationData(db, patch, false, id));
    if (patch.personIds) syncLinks(db, ctx, "organization", id, patch.personIds);
    if (patch.tagIds) setEntityTags(db, ctx, "organization", id, patch.tagIds);
    if (patch.customValues) setCustomValues(db, ctx, "organization", id, patch.customValues, { checkRequired: true });
  });
}

export function deleteOrganization(db: DatabaseSync, ctx: DbContext, id: string): void {
  withTransaction(db, () => {
    for (const link of many<{ person_id: string }>(db, "SELECT person_id FROM person_organization WHERE organization_id = ? AND deleted_at IS NULL", id)) {
      unlinkPersonOrganization(db, ctx, link.person_id, id);
    }
    softDelete(db, ctx, "organization", id);
  });
}

export function getOrganization(db: DatabaseSync, id: string, viewer?: Viewer | null): OrganizationDetail | undefined {
  const org = one<Organization>(db, `SELECT ${ORG_COLS} FROM organization WHERE id = ? AND deleted_at IS NULL`, id);
  if (!org) return undefined;
  const vis = personVisibility(viewer);
  return {
    ...org,
    persons: many(
      db,
      `SELECT p.id, p.name, po.is_primary FROM person_organization po
       JOIN person p ON p.id = po.person_id AND p.deleted_at IS NULL
       WHERE po.organization_id = ? AND po.deleted_at IS NULL${vis.sql} ORDER BY p.name COLLATE NOCASE`,
      id,
      ...vis.params,
    ),
    tags: getEntityTags(db, id),
    customValues: getCustomValues(db, id),
  };
}

export function listOrganizations(
  db: DatabaseSync,
  opts: { search?: string; segment?: string; ownerId?: string; limit?: number; offset?: number } = {},
): Organization[] {
  const where: string[] = ["deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (opts.search?.trim()) {
    const digits = opts.search.replace(/\D/g, "");
    where.push(`(name LIKE ? ESCAPE '\\' OR legal_name LIKE ? ESCAPE '\\'${digits.length >= 3 ? " OR cnpj LIKE ?" : ""})`);
    params.push(like(opts.search), like(opts.search));
    if (digits.length >= 3) params.push(`%${digits}%`);
  }
  if (opts.segment) {
    where.push("segment = ? COLLATE NOCASE");
    params.push(opts.segment);
  }
  if (opts.ownerId) {
    where.push("owner_id = ?");
    params.push(opts.ownerId);
  }
  return many<Organization>(
    db,
    `SELECT ${ORG_COLS} FROM organization WHERE ${where.join(" AND ")} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...params,
    opts.limit ?? 50,
    opts.offset ?? 0,
  );
}

export function findOrganizationByCnpj(db: DatabaseSync, cnpj: string): { id: string; name: string } | undefined {
  return one(db, "SELECT id, name FROM organization WHERE cnpj = ? AND deleted_at IS NULL", cnpj.replace(/\D/g, ""));
}

/** Segmentos já usados - sugestões do campo "Segmento" (spec 04). */
export function listSegments(db: DatabaseSync): string[] {
  return many<{ segment: string }>(
    db,
    "SELECT segment FROM organization WHERE segment IS NOT NULL AND deleted_at IS NULL GROUP BY segment COLLATE NOCASE ORDER BY segment COLLATE NOCASE",
  ).map((r) => r.segment);
}
