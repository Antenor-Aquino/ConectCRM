// Pesquisa geral (barra superior): cartões (título, contato, organização e
// número do ticket), contatos, organizações, atividades, notas e documentos,
// respeitando as permissões do usuário. Poucos resultados por grupo.
import { noteText } from "./notes";
import { normalizeText } from "../lib/search";
import { listActivities } from "./activities";
import { listOrganizations, listPersons, personVisibility } from "./contacts";
import { cardScope, ticketNumberQuery, type DealStatus } from "./deals";
import { listDocuments } from "./documents";
import type { DealKind } from "./pipelines";
import { many, type DatabaseSync } from "./sql";
import type { Viewer } from "./users";

export interface GlobalSearchResult {
  cards: { id: string; title: string; kind: DealKind; status: DealStatus; pipeline_id: string; pipeline_name: string; stage_name: string; ticket_number: number | null; person_name: string | null }[];
  persons: { id: string; name: string; email: string | null; phone: string | null; organization: string | null }[];
  organizations: { id: string; name: string; cnpj: string | null; city: string | null }[];
  activities: { id: string; title: string; due_at: string | null; done: number; deal_title: string | null }[];
  notes: { id: string; text: string; entity_type: "deal" | "person" | "organization"; entity_id: string; entity_name: string; pipeline_id: string | null }[];
  documents: { id: string; name: string; type_name: string | null }[];
}

const LIMIT = 5;

/** Texto da nota sem HTML, com o trecho em volta do termo. */
function snippet(html: string, term: string): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const at = normalizeText(text).indexOf(normalizeText(term));
  if (at < 0 || text.length <= 90) return text.slice(0, 90);
  const start = Math.max(0, at - 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 90)}…`;
}

export function globalSearch(db: DatabaseSync, text: string, viewer: Viewer | null): GlobalSearchResult {
  const term = text.trim();
  const empty: GlobalSearchResult = { cards: [], persons: [], organizations: [], activities: [], notes: [], documents: [] };
  if (term.length < 2 && ticketNumberQuery(term) === null) return empty;
  const q = `%${term}%`;
  const ticket = ticketNumberQuery(term);
  const scope = cardScope(db, viewer);
  const cards = many<GlobalSearchResult["cards"][number]>(
    db,
    `SELECT d.id, d.title, d.kind, d.status, d.pipeline_id, p.name AS pipeline_name, s.name AS stage_name, d.ticket_number, pe.name AS person_name
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id JOIN stage s ON s.id = d.stage_id
     LEFT JOIN person pe ON pe.id = d.person_id LEFT JOIN organization o ON o.id = d.organization_id
     WHERE d.deleted_at IS NULL AND (d.title LIKE ? OR pe.name LIKE ? OR o.name LIKE ?${ticket !== null ? " OR d.ticket_number = ?" : ""})${scope.sql}
     ORDER BY ${ticket !== null ? "d.ticket_number = ? DESC, " : ""}d.status = 'open' DESC, d.updated_at DESC LIMIT ?`,
    q,
    q,
    q,
    ...(ticket !== null ? [ticket] : []),
    ...scope.params,
    ...(ticket !== null ? [ticket] : []),
    LIMIT,
  );
  const persons = listPersons(db, { search: term, limit: LIMIT, viewer }).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    phone: p.phone,
    organization: p.primary_organization_name,
  }));
  const organizations = listOrganizations(db, { search: term, limit: LIMIT }).map((o) => ({ id: o.id, name: o.name, cnpj: o.cnpj, city: o.city }));
  const activities = listActivities(db, { search: term, limit: LIMIT, viewer }).map((a) => ({ id: a.id, title: a.title, due_at: a.due_at, done: a.done, deal_title: a.deal_title }));
  // Notas de cartões (com permissão), contatos (privados respeitados) e organizações.
  const pv = personVisibility(viewer, "pe");
  const notes = many<{ id: string; body: string; entity_type: "deal" | "person" | "organization"; entity_id: string; entity_name: string; pipeline_id: string | null }>(
    db,
    `SELECT n.id, n.body, n.entity_type, n.entity_id, COALESCE(d.title, pe.name, o.name) AS entity_name, d.pipeline_id
     FROM note n
     LEFT JOIN deal d ON n.entity_type = 'deal' AND d.id = n.entity_id AND d.deleted_at IS NULL
     LEFT JOIN person pe ON n.entity_type = 'person' AND pe.id = n.entity_id AND pe.deleted_at IS NULL
     LEFT JOIN organization o ON n.entity_type = 'organization' AND o.id = n.entity_id AND o.deleted_at IS NULL
     WHERE n.deleted_at IS NULL AND n.body LIKE ?
       AND ((n.entity_type = 'deal' AND d.id IS NOT NULL${scope.sql})
         OR (n.entity_type = 'person' AND pe.id IS NOT NULL${pv.sql})
         OR (n.entity_type = 'organization' AND o.id IS NOT NULL))
     ORDER BY n.created_at DESC LIMIT ?`,
    q,
    ...scope.params,
    ...pv.params,
    LIMIT,
  ).map(({ body, ...n }) => ({ ...n, text: snippet(noteText(body), term) }));
  const documents = listDocuments(db, { search: term, limit: LIMIT, viewer }).items.map((d) => ({ id: d.id, name: d.name, type_name: d.type_name }));
  return { cards, persons, organizations, activities, notes, documents };
}
