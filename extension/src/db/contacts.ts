// Contatos (spec 03) e organizações (spec 04), com o vínculo entre eles:
// um contato pode ter várias organizações e a primeira vira a principal.
import { normalizeCnpj, normalizeCpf, normalizeEmail, normalizePhone, optionalText, requireText, ValidationError } from "../lib/validate";
import { getCustomValues, setCustomValues, type CustomValue } from "./customFields";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { moveToTrash, type TrashNotice } from "./trash";
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
  /** CPF (opcional, para lançamentos na Gestão Financeira). */
  cpf?: string | null;
  notes?: string | null;
  ownerId?: string | null;
  isPrivate?: boolean;
  /** Foto (id em attachment; ver attachments.saveImage). */
  avatarId?: string | null;
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
  cpf: string | null;
  notes: string | null;
  avatar_id: string | null;
  owner_id: string | null;
  is_private: number;
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
  owner_name: string | null;
}

/** Contato privado só aparece para o responsável, quem criou e administradores (spec 03). */
export function personVisibility(viewer: Viewer | null | undefined, alias = "p"): { sql: string; params: SqlValue[] } {
  if (!viewer || viewer.role === "admin") return { sql: "", params: [] };
  return {
    sql: ` AND (${alias}.is_private = 0 OR ${alias}.owner_id = ? OR ${alias}.created_by = ?)`,
    params: [viewer.id, viewer.id],
  };
}

const PERSON_COLS = "p.id, p.name, p.email, p.phone, p.phone_country, p.cpf, p.notes, p.avatar_id, p.owner_id, p.is_private, p.created_by, p.version";

function personData(db: DatabaseSync, input: Partial<PersonInput>, full: boolean, exceptId?: string): Record<string, SqlValue> {
  const data: Record<string, SqlValue> = {};
  if (full || input.name !== undefined) data.name = requireText(input.name, "Informe o nome do contato.");
  if (full || input.email !== undefined) data.email = normalizeEmail(input.email);
  if (full || input.phone !== undefined || input.phoneCountry !== undefined) {
    const country = input.phoneCountry ?? "BR";
    data.phone = normalizePhone(input.phone, country);
    data.phone_country = data.phone ? country : null;
  }
  if (input.cpf !== undefined) {
    data.cpf = normalizeCpf(input.cpf);
    const dup = data.cpf && one<{ name: string }>(db, "SELECT name FROM person WHERE cpf = ? AND deleted_at IS NULL AND id <> ?", data.cpf, exceptId ?? "");
    if (dup) throw new ValidationError(`CPF já cadastrado em "${dup.name}".`);
  }
  if (full || input.notes !== undefined) data.notes = optionalText(input.notes);
  if (full || input.ownerId !== undefined) data.owner_id = checkOwner(db, input.ownerId);
  if (full || input.isPrivate !== undefined) data.is_private = input.isPrivate ? 1 : 0;
  if (input.avatarId !== undefined) data.avatar_id = input.avatarId;
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
    updateRow(db, ctx, "person", id, personData(db, patch, false, id));
    if (patch.organizationIds) syncLinks(db, ctx, "person", id, patch.organizationIds);
    if (patch.tagIds) setEntityTags(db, ctx, "person", id, patch.tagIds);
    if (patch.customValues) setCustomValues(db, ctx, "person", id, patch.customValues, { checkRequired: true });
  });
}

/** Para a lixeira, com as notas e as atividades ligadas só ao contato. */
export function deletePerson(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  return moveToTrash(db, ctx, "person", id, () => {
    for (const n of many<{ id: string }>(db, "SELECT id FROM note WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL", "person", id))
      softDelete(db, ctx, "note", n.id);
    for (const a of many<{ id: string }>(db, "SELECT id FROM activity WHERE person_id = ? AND deal_id IS NULL AND deleted_at IS NULL", id))
      softDelete(db, ctx, "activity", a.id);
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

export interface PersonFilter {
  search?: string;
  ownerId?: string;
  organizationId?: string;
  tagIds?: string[];
  viewer?: Viewer | null;
}

function personWhere(f: PersonFilter): { sql: string; params: SqlValue[] } {
  const where: string[] = ["p.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (f.search?.trim()) {
    const digits = f.search.replace(/\D/g, "");
    where.push(`(p.name LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\'${digits.length >= 3 ? " OR p.phone LIKE ?" : ""})`);
    params.push(like(f.search), like(f.search));
    if (digits.length >= 3) params.push(`%${digits}%`);
  }
  if (f.ownerId) {
    where.push("p.owner_id = ?");
    params.push(f.ownerId);
  }
  if (f.organizationId) {
    where.push("EXISTS (SELECT 1 FROM person_organization x WHERE x.person_id = p.id AND x.organization_id = ? AND x.deleted_at IS NULL)");
    params.push(f.organizationId);
  }
  if (f.tagIds?.length) {
    where.push(`EXISTS (SELECT 1 FROM entity_tag et WHERE et.entity_id = p.id AND et.deleted_at IS NULL AND et.tag_id IN (${f.tagIds.map(() => "?").join(", ")}))`);
    params.push(...f.tagIds);
  }
  const vis = personVisibility(f.viewer);
  return { sql: where.join(" AND ") + vis.sql, params: [...params, ...vis.params] };
}

/** Chaves de comparação de um telefone. No Brasil o WhatsApp às vezes traz o
 * celular sem o 9º dígito (ou com), então comparamos DDD + últimos 8 dígitos. */
export function phoneMatchKey(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return `55${d.slice(2, 4)}${d.slice(-8)}`;
  return d;
}

/** Contatos com o telefone da conversa aberta no WhatsApp (popup). */
export function findPersonsByPhone(db: DatabaseSync, phone: string, viewer?: Viewer | null): PersonListItem[] {
  const key = phoneMatchKey(phone);
  if (!key) return [];
  const last8 = key.slice(-8);
  return listPersons(db, { search: last8, viewer, limit: 200 }).filter((p) => phoneMatchKey(p.phone) === key);
}

/** Busca por nome, e-mail ou telefone (mesma busca do campo "Contato" dos formulários). */
export function listPersons(db: DatabaseSync, opts: PersonFilter & { limit?: number; offset?: number } = {}): PersonListItem[] {
  const w = personWhere(opts);
  return many<PersonListItem>(
    db,
    `SELECT ${PERSON_COLS},
       (SELECT o.name FROM person_organization po JOIN organization o ON o.id = po.organization_id AND o.deleted_at IS NULL
        WHERE po.person_id = p.id AND po.is_primary = 1 AND po.deleted_at IS NULL) AS primary_organization_name,
       (SELECT u.name FROM app_user u WHERE u.id = p.owner_id) AS owner_name
     FROM person p WHERE ${w.sql}
     ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...w.params,
    opts.limit ?? 50,
    opts.offset ?? 0,
  );
}

export function countPersons(db: DatabaseSync, f: PersonFilter = {}): number {
  const w = personWhere(f);
  return one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM person p WHERE ${w.sql}`, ...w.params)?.n ?? 0;
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
  /** Logo (id em attachment). */
  logoId?: string | null;
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
  if (input.logoId !== undefined) data.logo_id = input.logoId;
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

/** Para a lixeira, com as notas e as atividades ligadas só à organização. */
export function deleteOrganization(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  return moveToTrash(db, ctx, "organization", id, () => {
    for (const n of many<{ id: string }>(db, "SELECT id FROM note WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL", "organization", id))
      softDelete(db, ctx, "note", n.id);
    for (const a of many<{ id: string }>(
      db,
      "SELECT id FROM activity WHERE organization_id = ? AND deal_id IS NULL AND person_id IS NULL AND deleted_at IS NULL",
      id,
    ))
      softDelete(db, ctx, "activity", a.id);
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

export interface OrganizationFilter {
  search?: string;
  segment?: string;
  city?: string;
  state?: string;
  ownerId?: string;
  tagIds?: string[];
}

export interface OrganizationListItem extends Organization {
  persons_count: number;
  owner_name: string | null;
}

function organizationWhere(f: OrganizationFilter): { sql: string; params: SqlValue[] } {
  const where: string[] = ["o.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (f.search?.trim()) {
    const digits = f.search.replace(/\D/g, "");
    where.push(`(o.name LIKE ? ESCAPE '\\' OR o.legal_name LIKE ? ESCAPE '\\'${digits.length >= 3 ? " OR o.cnpj LIKE ?" : ""})`);
    params.push(like(f.search), like(f.search));
    if (digits.length >= 3) params.push(`%${digits}%`);
  }
  for (const [key, col] of [["segment", "segment"], ["city", "city"], ["state", "state"]] as const) {
    if (f[key]) {
      where.push(`o.${col} = ? COLLATE NOCASE`);
      params.push(f[key]!);
    }
  }
  if (f.ownerId) {
    where.push("o.owner_id = ?");
    params.push(f.ownerId);
  }
  if (f.tagIds?.length) {
    where.push(`EXISTS (SELECT 1 FROM entity_tag et WHERE et.entity_id = o.id AND et.deleted_at IS NULL AND et.tag_id IN (${f.tagIds.map(() => "?").join(", ")}))`);
    params.push(...f.tagIds);
  }
  return { sql: where.join(" AND "), params };
}

export function listOrganizations(db: DatabaseSync, opts: OrganizationFilter & { limit?: number; offset?: number } = {}): OrganizationListItem[] {
  const w = organizationWhere(opts);
  return many<OrganizationListItem>(
    db,
    `SELECT ${ORG_COLS.split(", ").map((c) => `o.${c}`).join(", ")},
       (SELECT COUNT(*) FROM person_organization po JOIN person p ON p.id = po.person_id AND p.deleted_at IS NULL
        WHERE po.organization_id = o.id AND po.deleted_at IS NULL) AS persons_count,
       (SELECT u.name FROM app_user u WHERE u.id = o.owner_id) AS owner_name
     FROM organization o WHERE ${w.sql} ORDER BY o.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...w.params,
    opts.limit ?? 50,
    opts.offset ?? 0,
  );
}

export function countOrganizations(db: DatabaseSync, f: OrganizationFilter = {}): number {
  const w = organizationWhere(f);
  return one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM organization o WHERE ${w.sql}`, ...w.params)?.n ?? 0;
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
