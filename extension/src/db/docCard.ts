// Copiloto: cria o cartão a partir de um documento (spec 12), depois que o
// usuário confere os dados. Tudo numa transação: organização e contato (novos
// ou existentes), tags (as que faltam são criadas), o cartão, o documento no
// GED (vinculado ao cartão, à organização e ao contato) e o registro de origem
// — que o histórico mostra numa linha só.
import { createOrganization, createPerson, linkPersonOrganization, type OrganizationInput, type PersonInput } from "./contacts";
import { createCard } from "./deals";
import { addDocumentLinks, createDocument, documentsBySha, type DocLinkRef, type FileRef } from "./documents";
import { KIND_BY_PIPELINE_TYPE, type PipelineType } from "./pipelines";
import { getRow, insertRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";
import { createTag, listTags } from "./tags";
import type { Viewer } from "./users";
import { uniqueNames, ValidationError } from "../lib/validate";

export const DOC_CARD_ORIGIN = "Documento (Copiloto)";

export interface DocCardInput {
  pipelineId: string;
  stageId: string;
  title: string;
  description?: string | null;
  valueCents?: number | null;
  expectedCloseAt?: string | null;
  /** Existente ({ id }), nova ({ create }) ou nenhuma. */
  organization: { id: string } | { create: OrganizationInput } | null;
  person: { id: string } | { create: PersonInput } | null;
  /** Nomes; os que não existem no tipo do cartão são criados. */
  tags: string[];
  document: { name: string; typeId: string | null; description?: string | null; file: FileRef };
  /** Para o histórico: arquivo, tipo identificado e IA usada. */
  source: { fileName: string; docType: string; provider: string };
}

export interface DocCardResult {
  cardId: string;
  organizationId: string | null;
  personId: string | null;
  documentId: string;
}

/** Resumo guardado no registro de origem (vira as linhas do histórico). */
export interface OriginSummary {
  file: string;
  docType: string;
  provider: string;
  organization?: { name: string; created: boolean };
  person?: { name: string; created: boolean };
  tags?: { name: string; created: boolean }[];
  document?: string;
}

export function createCardFromDocument(db: DatabaseSync, ctx: DbContext, viewer: Viewer | null, p: DocCardInput): DocCardResult {
  return withTransaction(db, () => {
    const pipeline = one<{ type: PipelineType }>(db, "SELECT type FROM pipeline WHERE id = ? AND deleted_at IS NULL", p.pipelineId);
    if (!pipeline) throw new ValidationError("Funil não encontrado.");
    const kind = KIND_BY_PIPELINE_TYPE[pipeline.type];
    const summary: OriginSummary = { file: p.source.fileName, docType: p.source.docType, provider: p.source.provider };

    let organizationId: string | null = null;
    if (p.organization && "id" in p.organization) {
      const o = getRow(db, "organization", p.organization.id);
      if (!o) throw new ValidationError("Organização não encontrada.");
      organizationId = p.organization.id;
      summary.organization = { name: String(o.name), created: false };
    } else if (p.organization) {
      organizationId = createOrganization(db, ctx, { ...p.organization.create, ownerId: p.organization.create.ownerId ?? ctx.userId });
      summary.organization = { name: p.organization.create.name, created: true };
    }

    let personId: string | null = null;
    if (p.person && "id" in p.person) {
      const r = getRow(db, "person", p.person.id);
      if (!r) throw new ValidationError("Contato não encontrado.");
      personId = p.person.id;
      if (organizationId) linkPersonOrganization(db, ctx, personId, organizationId);
      summary.person = { name: String(r.name), created: false };
    } else if (p.person) {
      personId = createPerson(db, ctx, { ...p.person.create, organizationIds: organizationId ? [organizationId] : [] });
      summary.person = { name: p.person.create.name, created: true };
    }

    // Tags do tipo do cartão (negócio, ticket ou projeto), pelo nome sem diferenciar maiúsculas.
    const existing = listTags(db, kind, { includeInactive: true });
    const tagIds: string[] = [];
    summary.tags = [];
    for (const name of uniqueNames(p.tags)) {
      const found = existing.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
      tagIds.push(found?.id ?? createTag(db, ctx, { entity: kind, name }));
      summary.tags.push({ name: found?.name ?? name, created: !found });
    }

    const cardId = createCard(db, ctx, {
      pipelineId: p.pipelineId,
      stageId: p.stageId,
      title: p.title,
      description: p.description ?? null,
      valueCents: p.valueCents ?? undefined,
      expectedCloseAt: p.expectedCloseAt ?? undefined,
      personId,
      organizationId,
      ownerId: ctx.userId,
      origin: DOC_CARD_ORIGIN,
      tagIds,
    });

    // Documento no GED; o mesmo arquivo já guardado ganha os vínculos novos.
    const links: DocLinkRef[] = [
      { type: "deal", id: cardId },
      ...(organizationId ? [{ type: "organization" as const, id: organizationId }] : []),
      ...(personId ? [{ type: "person" as const, id: personId }] : []),
    ];
    const dup = documentsBySha(db, p.document.file.sha256, viewer)[0];
    let documentId: string;
    if (dup) {
      documentId = dup.id;
      addDocumentLinks(db, ctx, dup.id, links);
    } else {
      documentId = createDocument(db, ctx, {
        name: p.document.name,
        // Sem tipo escolhido: "Outros" (o GED exige a classificação).
        typeId: p.document.typeId ?? one<{ id: string }>(db, "SELECT id FROM document_type WHERE name = 'Outros' AND deleted_at IS NULL")?.id ?? null,
        description: p.document.description ?? null,
        links,
        file: p.document.file,
      });
    }
    summary.document = dup?.name ?? p.document.name;

    const origin = (entity: "deal" | "person" | "organization", id: string) =>
      insertRow(db, ctx, "record_origin", { entity_type: entity, local_id: id, source: "copilot-document", document_id: documentId, summary: JSON.stringify(summary) });
    origin("deal", cardId);
    if (summary.organization?.created && organizationId) origin("organization", organizationId);
    if (summary.person?.created && personId) origin("person", personId);
    return { cardId, organizationId, personId, documentId };
  });
}

/** Linhas resumidas do histórico ("Criado pelo Copiloto a partir do documento…"). */
export function originLines(s: OriginSummary, entity: "deal" | "person" | "organization" = "deal"): string[] {
  const what = entity === "deal" ? "Criado" : entity === "person" ? "Contato criado" : "Organização criada";
  const lines = [`${what} pelo Copiloto (${s.provider}) a partir do documento "${s.file}" (${s.docType})`];
  if (entity !== "deal") return lines;
  const parts = [
    s.organization ? `organização ${s.organization.name} (${s.organization.created ? "nova" : "existente"})` : "",
    s.person ? `contato ${s.person.name} (${s.person.created ? "novo" : "existente"})` : "",
    s.tags?.length ? `tags ${s.tags.map((t) => `${t.name}${t.created ? " (nova)" : ""}`).join(", ")}` : "",
    s.document ? `documento salvo no GED como "${s.document}"` : "",
  ].filter(Boolean);
  if (parts.length) lines.push(`Com ${parts.join("; ")}`);
  return lines;
}

export interface RecordOrigin {
  source: string;
  documentId: string | null;
  createdAt: string;
  summary: OriginSummary;
}

/** Origem de um registro (cartão, contato, organização), se foi criado por automação. */
export function recordOrigin(db: DatabaseSync, localId: string): RecordOrigin | null {
  const r = many<{ source: string; document_id: string | null; created_at: string; summary: string }>(
    db,
    "SELECT source, document_id, created_at, summary FROM record_origin WHERE local_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
    localId,
  )[0];
  if (!r) return null;
  try {
    return { source: r.source, documentId: r.document_id, createdAt: r.created_at, summary: JSON.parse(r.summary) as OriginSummary };
  } catch {
    return null;
  }
}
