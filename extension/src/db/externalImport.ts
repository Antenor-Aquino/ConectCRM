// Importação de integrações (spec 09): contatos, organizações e cartões
// vindos de um sistema externo (Pipedrive). A tela busca na origem, faz o
// de-para e manda as linhas já convertidas; aqui cada linha é gravada numa
// transação e fica vinculada ao registro de origem (external_ref), o que
// permite mostrar "já importado", atualizar depois e abrir o original.
import { errorText } from "../lib/errors";
import { parseImportDate, parseMoneyCents } from "../lib/importParse";
import { normalizeCnpj, normalizeEmail, normalizePhone, ValidationError } from "../lib/validate";
import {
  createOrganization,
  createPerson,
  findDuplicatePersons,
  findOrganizationByCnpj,
  linkPersonOrganization,
  updateOrganization,
  updatePerson,
} from "./contacts";
import { listCustomFields, type CustomField, type CustomFieldEntity, type CustomValue } from "./customFields";
import { createCard, updateCard } from "./deals";
import type { ImportSummary } from "./importer";
import { customValueFromText, tagIdsByName } from "./importValues";
import { KIND_BY_PIPELINE_TYPE, type PipelineType } from "./pipelines";
import { insertRow, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";
import { getEntityTags, type TagEntity } from "./tags";

export type ExternalProvider = "pipedrive";
export type ExternalEntity = "person" | "organization" | "deal";

const TABLE: Record<ExternalEntity, "person" | "organization" | "deal"> = { person: "person", organization: "organization", deal: "deal" };

export interface ExternalLink {
  externalId: string;
  localId: string;
  localName: string;
  sourceUpdatedAt: string | null;
  importedAt: string;
}

/** Vínculos ativos (registro local não excluído) dos ids de origem informados. */
export function externalLinks(db: DatabaseSync, provider: ExternalProvider, entity: ExternalEntity, externalIds: string[]): Map<string, ExternalLink> {
  const out = new Map<string, ExternalLink>();
  const nameCol = entity === "deal" ? "title" : "name";
  for (let i = 0; i < externalIds.length; i += 500) {
    const ids = externalIds.slice(i, i + 500);
    if (!ids.length) continue;
    for (const r of many<ExternalLink>(
      db,
      `SELECT r.external_id AS externalId, r.local_id AS localId, l.${nameCol} AS localName, r.source_updated_at AS sourceUpdatedAt, r.imported_at AS importedAt
       FROM external_ref r JOIN ${TABLE[entity]} l ON l.id = r.local_id AND l.deleted_at IS NULL
       WHERE r.provider = ? AND r.entity_type = ? AND r.deleted_at IS NULL AND r.external_id IN (${ids.map(() => "?").join(",")})`,
      provider,
      entity,
      ...ids,
    ))
      out.set(r.externalId, r);
  }
  return out;
}

/** Origem dos registros locais (para "Importado do Pipedrive ↗"). */
export function externalRefsOf(
  db: DatabaseSync,
  localId: string,
): { provider: ExternalProvider; entity: ExternalEntity; externalId: string; importedAt: string }[] {
  return many(
    db,
    "SELECT provider, entity_type AS entity, external_id AS externalId, imported_at AS importedAt FROM external_ref WHERE local_id = ? AND deleted_at IS NULL ORDER BY imported_at",
    localId,
  );
}

function saveLink(
  db: DatabaseSync,
  ctx: DbContext,
  provider: ExternalProvider,
  entity: ExternalEntity,
  externalId: string,
  localId: string,
  sourceUpdatedAt?: string | null,
) {
  const at = new Date().toISOString();
  const cur = one<{ id: string }>(
    db,
    "SELECT id FROM external_ref WHERE provider = ? AND entity_type = ? AND external_id = ? AND deleted_at IS NULL",
    provider,
    entity,
    externalId,
  );
  const data = { local_id: localId, source_updated_at: sourceUpdatedAt ?? null, imported_at: at };
  if (cur) updateRow(db, ctx, "external_ref", cur.id, data);
  else insertRow(db, ctx, "external_ref", { provider, entity_type: entity, external_id: externalId, ...data });
}

/** Local de um id de origem já importado (ou undefined). */
export function localIdOf(db: DatabaseSync, provider: ExternalProvider, entity: ExternalEntity, externalId: string | undefined | null): string | undefined {
  if (!externalId) return undefined;
  return externalLinks(db, provider, entity, [externalId]).get(externalId)?.localId;
}

// ---------- Situação: novo, já importado ou possível duplicado ----------

export interface ExternalCheckItem {
  externalId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  cnpj?: string | null;
  updatedAt?: string | null;
}

export interface ExternalCheckResult {
  externalId: string;
  status: "new" | "imported" | "duplicate";
  localId?: string;
  localName?: string;
  /** Já importado e alterado na origem depois da última importação. */
  changed?: boolean;
  /** Possível duplicado: o que coincidiu. */
  match?: "email" | "phone" | "cnpj" | "name";
}

export function checkExternal(db: DatabaseSync, provider: ExternalProvider, entity: ExternalEntity, items: ExternalCheckItem[]): ExternalCheckResult[] {
  const links = externalLinks(
    db,
    provider,
    entity,
    items.map((i) => i.externalId),
  );
  // Locais já vinculados a outro registro de origem não contam como duplicado.
  const linkedLocal = new Set(
    many<{ local_id: string }>(db, "SELECT local_id FROM external_ref WHERE provider = ? AND entity_type = ? AND deleted_at IS NULL", provider, entity).map(
      (r) => r.local_id,
    ),
  );
  return items.map((item) => {
    const link = links.get(item.externalId);
    if (link) {
      const changed = !!item.updatedAt && !!link.sourceUpdatedAt && new Date(item.updatedAt).getTime() > new Date(link.sourceUpdatedAt).getTime();
      return { externalId: item.externalId, status: "imported", localId: link.localId, localName: link.localName, changed };
    }
    const dup = findLocalDuplicate(db, entity, item, linkedLocal);
    return dup ? { externalId: item.externalId, status: "duplicate", ...dup } : { externalId: item.externalId, status: "new" };
  });
}

function findLocalDuplicate(
  db: DatabaseSync,
  entity: ExternalEntity,
  item: ExternalCheckItem,
  linked: Set<string>,
): Pick<ExternalCheckResult, "localId" | "localName" | "match"> | undefined {
  const free = (r: { id: string; name: string } | undefined, match: ExternalCheckResult["match"]) =>
    r && !linked.has(r.id) ? { localId: r.id, localName: r.name, match } : undefined;
  if (entity === "person") {
    for (const d of findDuplicatePersons(db, { email: item.email, phone: item.phone })) {
      const hit = free(d, d.match);
      if (hit) return hit;
    }
    return free(one(db, "SELECT id, name FROM person WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL", item.name.trim()), "name");
  }
  if (entity === "organization") {
    const cnpj = item.cnpj?.replace(/\D/g, "");
    return (
      (cnpj && cnpj.length === 14 ? free(findOrganizationByCnpj(db, cnpj), "cnpj") : undefined) ??
      free(one(db, "SELECT id, name FROM organization WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL", item.name.trim()), "name")
    );
  }
  return free(one(db, "SELECT id, title AS name FROM deal WHERE kind = 'deal' AND title = ? COLLATE NOCASE AND deleted_at IS NULL", item.name.trim()), "name");
}

// ---------- Gravação ----------

interface BaseRow {
  externalId: string;
  /** Nome para as mensagens do resumo. */
  label: string;
  sourceUpdatedAt?: string | null;
  /** Registro local a usar (já importado ou duplicado escolhido para vincular). Sem ele, cria. */
  localId?: string;
  /** Com localId: grava no registro existente os campos do de-para. */
  update?: boolean;
  /** undefined = quem importa (ao criar) / não muda (ao atualizar); null = sem responsável. */
  ownerId?: string | null;
  /** Nomes de tags (criadas se não existirem); somadas às que o registro já tem. */
  tags?: string[];
  /** Campo personalizado → texto (opções: id escolhido no de-para ou rótulo). */
  custom?: Record<string, string | string[]>;
}

export interface ExternalPersonRow extends BaseRow {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  organizationExternalId?: string;
}

export interface ExternalOrganizationRow extends BaseRow {
  name?: string;
  legalName?: string;
  cnpj?: string;
  website?: string;
  segment?: string;
  email?: string;
  phone?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
  description?: string;
}

export interface ExternalDealRow extends BaseRow {
  title?: string;
  /** Valor em reais ("1500.5", "R$ 1.500,00"). */
  value?: string;
  expectedCloseAt?: string;
  origin?: string;
  description?: string;
  personExternalId?: string;
  organizationExternalId?: string;
}

export interface ExternalImportInput<R> {
  provider: ExternalProvider;
  rows: R[];
  /** Cartões (leads): funil comercial e etapa de entrada dos novos. */
  pipelineId?: string;
  stageId?: string;
  /** Número da primeira linha (a tela manda em lotes). */
  firstRow?: number;
}

export interface ExternalImportSummary extends ImportSummary {
  updated: number;
  linked: number;
  /** Importados, mas com algum dado deixado de fora (e-mail, telefone ou CNPJ inválido). */
  warnings: { row: number; message: string }[];
}

type Ctx = {
  db: DatabaseSync;
  ctx: DbContext;
  provider: ExternalProvider;
  fields: Map<string, CustomField>;
  tagEntity: TagEntity;
  tagCache: Map<string, string>;
  warn: (msg: string) => void;
};

/** Campo opcional que não pode derrubar a linha: inválido → fica de fora com aviso. */
function lenient<T>(c: Ctx, raw: string | undefined, label: string, fn: (v: string) => T): T | undefined {
  if (raw === undefined) return undefined;
  if (!raw.trim()) return null as T;
  try {
    return fn(raw);
  } catch {
    c.warn(`${label} "${raw}" inválido, ficou de fora`);
    return undefined;
  }
}

function customValues(c: Ctx, raw: BaseRow["custom"]): Record<string, CustomValue> | undefined {
  if (!raw) return undefined;
  const out: Record<string, CustomValue> = {};
  for (const [fieldId, v] of Object.entries(raw)) {
    const field = c.fields.get(fieldId);
    if (!field || field.field_type === "document") continue;
    const value = customValueFromText(c.db, field, v);
    if (value !== null) out[fieldId] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Tags novas somadas às que o registro já tem (atualizar não apaga tags do CRM). */
function mergedTags(c: Ctx, localId: string | undefined, names: string[] | undefined): string[] | undefined {
  const ids = tagIdsByName(c.db, c.ctx, c.tagEntity, names ?? [], c.tagCache);
  if (!ids) return undefined;
  if (!localId) return ids;
  return [...new Set([...getEntityTags(c.db, localId).map((t) => t.id), ...ids])];
}

/** Só os campos mapeados e preenchidos entram (vazio na origem não apaga o que o CRM tem).
 * Responsável null é intencional ("sem responsável") e fica. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && (k === "ownerId" || (v !== null && v !== "")))) as Partial<T>;
}

function run<R extends BaseRow>(
  db: DatabaseSync,
  ctx: DbContext,
  input: ExternalImportInput<R>,
  entity: ExternalEntity,
  fieldsEntity: CustomFieldEntity,
  tagEntity: TagEntity,
  write: (c: Ctx, row: R, mode: "create" | "update" | "link") => string,
  opts: { pipelineId?: string } = {},
): ExternalImportSummary {
  const summary: ExternalImportSummary = { created: 0, updated: 0, linked: 0, skipped: [], errors: [], warnings: [] };
  const fields = new Map(listCustomFields(db, fieldsEntity, { pipelineId: opts.pipelineId }).map((f) => [f.id, f]));
  const tagCache = new Map<string, string>();
  input.rows.forEach((row, i) => {
    const line = i + (input.firstRow ?? 1);
    const notes: string[] = [];
    try {
      const mode = !row.localId ? "create" : row.update ? "update" : "link";
      withTransaction(db, () => {
        const c: Ctx = { db, ctx, provider: input.provider, fields, tagEntity, tagCache, warn: (m) => notes.push(m) };
        const localId = write(c, row, mode);
        saveLink(db, ctx, input.provider, entity, row.externalId, localId, row.sourceUpdatedAt);
      });
      if (mode === "create") summary.created++;
      else if (mode === "update") summary.updated++;
      else summary.linked++;
      if (notes.length) summary.warnings.push({ row: line, message: `${row.label}: ${notes.join("; ")}.` });
    } catch (e) {
      tagCache.clear(); // tags criadas na linha voltaram com a transação
      summary.errors.push({ row: line, message: `${row.label}: ${errorText(e)}` });
    }
  });
  return summary;
}

export function importExternalOrganizations(db: DatabaseSync, ctx: DbContext, input: ExternalImportInput<ExternalOrganizationRow>): ExternalImportSummary {
  return run(db, ctx, input, "organization", "organization", "organization", (c, row, mode) => {
    if (mode === "link") return row.localId!;
    const data = defined({
      name: row.name?.trim() || undefined,
      legalName: row.legalName,
      cnpj: lenient(c, row.cnpj, "CNPJ", (v) => normalizeCnpj(v)),
      website: row.website,
      segment: row.segment,
      email: lenient(c, row.email, "E-mail", (v) => normalizeEmail(v)),
      phone: lenient(c, row.phone, "Telefone", (v) => normalizePhone(v)),
      cep: row.cep,
      street: row.street,
      number: row.number,
      complement: row.complement,
      district: row.district,
      city: row.city,
      state: row.state,
      country: row.country,
      description: row.description,
      ownerId: row.ownerId,
      customValues: customValues(c, row.custom),
    });
    // CNPJ que já está em outra organização: importa sem ele.
    if (data.cnpj) {
      const other = findOrganizationByCnpj(db, data.cnpj);
      if (other && other.id !== row.localId) {
        c.warn(`CNPJ já cadastrado em ${other.name}, ficou de fora`);
        delete data.cnpj;
      }
    }
    const tagIds = mergedTags(c, row.localId, row.tags);
    if (mode === "update") {
      updateOrganization(db, ctx, row.localId!, { ...data, ...(tagIds ? { tagIds } : {}) });
      return row.localId!;
    }
    if (!data.name) throw new ValidationError("sem nome da organização.");
    return createOrganization(db, ctx, { ...data, name: data.name, tagIds });
  });
}

export function importExternalPersons(db: DatabaseSync, ctx: DbContext, input: ExternalImportInput<ExternalPersonRow>): ExternalImportSummary {
  return run(db, ctx, input, "person", "person", "person", (c, row, mode) => {
    const orgId = localIdOf(db, c.provider, "organization", row.organizationExternalId);
    let id = row.localId;
    if (mode !== "link") {
      const data = defined({
        name: row.name?.trim() || undefined,
        email: lenient(c, row.email, "E-mail", (v) => normalizeEmail(v)),
        phone: lenient(c, row.phone, "Telefone", (v) => normalizePhone(v)),
        notes: row.notes,
        ownerId: row.ownerId,
        customValues: customValues(c, row.custom),
      });
      const tagIds = mergedTags(c, row.localId, row.tags);
      if (mode === "update") updatePerson(db, ctx, id!, { ...data, ...(tagIds ? { tagIds } : {}) });
      else {
        const name = data.name || data.email || data.phone;
        if (!name) throw new ValidationError("sem nome do contato.");
        id = createPerson(db, ctx, { ...data, name, tagIds });
      }
    }
    if (orgId) linkPersonOrganization(db, ctx, id!, orgId);
    return id!;
  });
}

export function importExternalDeals(db: DatabaseSync, ctx: DbContext, input: ExternalImportInput<ExternalDealRow>): ExternalImportSummary {
  const pipeline = input.pipelineId
    ? one<{ id: string; type: PipelineType }>(db, "SELECT id, type FROM pipeline WHERE id = ? AND deleted_at IS NULL", input.pipelineId)
    : undefined;
  if (!pipeline) throw new ValidationError("Escolha o funil de destino.");
  const kind = KIND_BY_PIPELINE_TYPE[pipeline.type];
  if (kind !== "deal") throw new ValidationError("Os leads entram num funil comercial.");
  return run(
    db,
    ctx,
    input,
    "deal",
    kind,
    kind,
    (c, row, mode) => {
      if (mode === "link") return row.localId!;
      const personId = localIdOf(db, c.provider, "person", row.personExternalId);
      const organizationId = localIdOf(db, c.provider, "organization", row.organizationExternalId);
      const data = defined({
        title: row.title?.trim() || undefined,
        valueCents: parseMoneyCents(row.value, "Valor") ?? undefined,
        expectedCloseAt: parseImportDate(row.expectedCloseAt, "Previsão de fechamento"),
        origin: row.origin,
        description: row.description,
        ownerId: row.ownerId,
        personId,
        organizationId,
        customValues: customValues(c, row.custom),
      });
      const tagIds = mergedTags(c, row.localId, row.tags);
      if (mode === "update") {
        updateCard(db, ctx, row.localId!, { ...data, ...(tagIds ? { tagIds } : {}) });
        return row.localId!;
      }
      if (!data.title) throw new ValidationError("sem título do lead.");
      return createCard(db, ctx, { ...data, title: data.title, pipelineId: pipeline.id, stageId: input.stageId || undefined, tagIds });
    },
    { pipelineId: pipeline.id },
  );
}
