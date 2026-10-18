// Importação de cartões por planilha (spec 01, seção 10.1.2). A tela lê o
// arquivo, faz o de-para das colunas e dos valores (etapa, responsável,
// status e opções) e manda as linhas; aqui cada linha é convertida e gravada
// numa transação só: contato e organização são achados ou criados, tags
// criadas quando não existem, e o cartão entra na etapa escolhida.
import { errorText } from "../lib/errors";
import { importKey, parseImportDate, parseMoneyCents, splitList } from "../lib/importParse";
import { ValidationError } from "../lib/validate";
import { createOrganization, createPerson, findDuplicatePersons, linkPersonOrganization } from "./contacts";
import { listCustomFields, type CustomField, type CustomValue } from "./customFields";
import { customValueFromText, idByName as byName, tagIdsByName } from "./importValues";
import { createCard, setCardStatus, type DealStatus } from "./deals";
import type { ImportSummary } from "./importer";
import { KIND_BY_PIPELINE_TYPE, type PipelineType } from "./pipelines";
import type { DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export interface CardImportRow {
  title?: string;
  /** Já resolvida pelo de-para; sem etapa, usa `defaultStageId`. */
  stageId?: string;
  /** Já resolvido pelo de-para; ausente = aberto. */
  status?: DealStatus;
  /** Já resolvido pelo de-para; ausente = quem importa; null = sem responsável. */
  ownerId?: string | null;
  value?: string;
  description?: string;
  origin?: string;
  personName?: string;
  personEmail?: string;
  personPhone?: string;
  organizationName?: string;
  /** Nomes separados por ";" ou ",". */
  tags?: string;
  expectedCloseAt?: string;
  slaAt?: string;
  startAt?: string;
  dueAt?: string;
  /** Campo personalizado → texto da planilha (opções: id já escolhido no de-para ou o rótulo). */
  custom?: Record<string, string | string[]>;
}

export interface CardImportInput {
  pipelineId: string;
  defaultStageId?: string;
  rows: CardImportRow[];
  /** Ignora linhas cujo nome já existe neste funil (padrão: sim). */
  skipExisting?: boolean;
  /** Linha da planilha da primeira linha enviada (a tela manda em lotes). */
  firstLine?: number;
}

/** Tipos de campo personalizado que a importação aceita (documento só pelo GED). */
export const IMPORTABLE_FIELD_TYPES = new Set<CustomField["field_type"]>([
  "text",
  "textarea",
  "number",
  "money",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiselect",
  "phone",
  "email",
  "url",
  "user",
  "person",
  "organization",
]);

/** Contato pelo e-mail/celular, depois pelo nome; sem nenhum, cria. */
function resolvePerson(db: DatabaseSync, ctx: DbContext, row: CardImportRow): string | null {
  const name = row.personName?.trim();
  const email = row.personEmail?.trim() || null;
  const phone = row.personPhone?.trim() || null;
  if (!name && !email && !phone) return null;
  const dup = findDuplicatePersons(db, { email, phone });
  if (dup.length) return dup[0]!.id;
  if (name) {
    const id = byName(db, "person", name);
    if (id) return id;
  }
  return createPerson(db, ctx, { name: name || email || phone!, email, phone });
}

export function importCards(
  db: DatabaseSync,
  ctx: DbContext,
  input: CardImportInput,
  /** Permissão de atribuir o responsável (vendedor só a si, gestor à equipe). */
  canAssign: (ownerId: string | null | undefined) => void = () => {},
): ImportSummary {
  const pipeline = one<{ id: string; type: PipelineType }>(db, "SELECT id, type FROM pipeline WHERE id = ? AND deleted_at IS NULL", input.pipelineId);
  if (!pipeline) throw new ValidationError("Funil não encontrado.");
  const kind = KIND_BY_PIPELINE_TYPE[pipeline.type];
  const fields = new Map(listCustomFields(db, kind, { pipelineId: pipeline.id }).map((f) => [f.id, f]));
  const existing = new Set(
    many<{ title: string }>(db, "SELECT title FROM deal WHERE pipeline_id = ? AND deleted_at IS NULL", pipeline.id).map((r) => importKey(r.title)),
  );
  const tagCache = new Map<string, string>();
  const summary: ImportSummary = { created: 0, skipped: [], errors: [] };
  input.rows.forEach((row, i) => {
    const line = i + (input.firstLine ?? 2); // linha 1 = cabeçalho da planilha
    const title = row.title?.trim() ?? "";
    try {
      if (!title) throw new ValidationError("sem nome do cartão.");
      if (input.skipExisting !== false && existing.has(importKey(title))) {
        summary.skipped.push({ row: line, reason: `já existe neste funil: ${title}` });
        return;
      }
      withTransaction(db, () => {
        canAssign(row.ownerId === undefined ? ctx.userId : row.ownerId);
        const personId = resolvePerson(db, ctx, row);
        let organizationId: string | undefined;
        const orgName = row.organizationName?.trim();
        if (orgName) {
          organizationId = byName(db, "organization", orgName) ?? createOrganization(db, ctx, { name: orgName });
          if (personId) linkPersonOrganization(db, ctx, personId, organizationId);
        }
        const customValues: Record<string, CustomValue> = {};
        for (const [fieldId, raw] of Object.entries(row.custom ?? {})) {
          const field = fields.get(fieldId);
          if (!field || !IMPORTABLE_FIELD_TYPES.has(field.field_type)) continue;
          const v = customValueFromText(db, field, raw);
          if (v !== null) customValues[fieldId] = v;
        }
        const id = createCard(db, ctx, {
          pipelineId: pipeline.id,
          stageId: row.stageId || input.defaultStageId || undefined,
          title,
          description: row.description?.trim() || null,
          valueCents: parseMoneyCents(row.value, "Valor") ?? undefined,
          origin: row.origin?.trim() || null,
          personId,
          organizationId,
          ownerId: row.ownerId,
          expectedCloseAt: kind === "deal" ? parseImportDate(row.expectedCloseAt, "Previsão de fechamento") : undefined,
          slaAt: kind === "ticket" ? parseImportDate(row.slaAt, "SLA") : undefined,
          startAt: kind === "project" ? parseImportDate(row.startAt, "Início") : undefined,
          dueAt: kind === "project" ? parseImportDate(row.dueAt, "Prazo") : undefined,
          tagIds: tagIdsByName(db, ctx, kind, splitList(row.tags), tagCache),
          customValues,
        });
        if (row.status && row.status !== "open") setCardStatus(db, ctx, id, { status: row.status });
      });
      existing.add(importKey(title));
      summary.created++;
    } catch (e) {
      // Tags criadas nesta linha voltaram com a transação: relê na próxima.
      tagCache.clear();
      summary.errors.push({ row: line, message: errorText(e) });
    }
  });
  return summary;
}
