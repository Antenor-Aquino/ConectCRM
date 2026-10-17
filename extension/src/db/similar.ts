// Anti-duplicidade: cadastros com nome parecido (> 70% em alguma parte do
// texto) ao criar contato, organização ou cartão. Respeita a permissão de
// quem consulta (contato privado e cartões de outras equipes não aparecem).
import { isSimilar, nameSimilarity } from "../lib/similarity";
import { personVisibility } from "./contacts";
import { cardScope, type DealStatus } from "./deals";
import type { DealKind } from "./pipelines";
import { many, type DatabaseSync } from "./sql";
import type { Viewer } from "./users";

export interface SimilarItem {
  id: string;
  name: string;
  /** 0..100 */
  score: number;
  /** Detalhes para distinguir homônimos (organização, e-mail, cidade…). */
  details: string[];
}

export interface SimilarCard extends SimilarItem {
  pipeline_id: string;
  status: DealStatus;
  /** "title" = título parecido; "person"/"organization" = mesmo contato/organização com cartão em aberto. */
  reason: "title" | "person" | "organization";
}

function rank<T extends { name: string }>(rows: T[], text: string, limit: number): (T & { score: number })[] {
  return rows
    .map((r) => ({ ...r, score: nameSimilarity(text, r.name) }))
    .filter((r) => isSimilar(r.score))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((r) => ({ ...r, score: Math.round(r.score * 100) }));
}

const compact = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x);

export function similarPersons(db: DatabaseSync, p: { name: string; excludeId?: string; limit?: number }, viewer?: Viewer | null): SimilarItem[] {
  const vis = personVisibility(viewer);
  const rows = many<{ id: string; name: string; email: string | null; phone: string | null; org: string | null }>(
    db,
    `SELECT p.id, p.name, p.email, p.phone,
       (SELECT o.name FROM person_organization po JOIN organization o ON o.id = po.organization_id
        WHERE po.person_id = p.id AND po.is_primary = 1 AND po.deleted_at IS NULL) AS org
     FROM person p WHERE p.deleted_at IS NULL AND p.id <> ?${vis.sql}`,
    p.excludeId ?? "",
    ...vis.params,
  );
  return rank(rows, p.name, p.limit ?? 5).map((r) => ({ id: r.id, name: r.name, score: r.score, details: compact([r.org, r.email, r.phone]) }));
}

export function similarOrganizations(db: DatabaseSync, p: { name: string; excludeId?: string; limit?: number }): SimilarItem[] {
  const rows = many<{ id: string; name: string; legal_name: string | null; cnpj: string | null; city: string | null }>(
    db,
    "SELECT id, name, legal_name, cnpj, city FROM organization WHERE deleted_at IS NULL AND id <> ?",
    p.excludeId ?? "",
  );
  // A razão social também conta ("Stepple" × "Stepple Tecnologia Ltda").
  const scored = rows
    .map((r) => ({ ...r, score: Math.max(nameSimilarity(p.name, r.name), r.legal_name ? nameSimilarity(p.name, r.legal_name) : 0) }))
    .filter((r) => isSimilar(r.score))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, p.limit ?? 5);
  return scored.map((r) => ({
    id: r.id,
    name: r.name,
    score: Math.round(r.score * 100),
    details: compact([r.legal_name && r.legal_name !== r.name ? r.legal_name : null, r.cnpj ? `CNPJ ${r.cnpj}` : null, r.city]),
  }));
}

export function similarCards(
  db: DatabaseSync,
  p: { title: string; kind: DealKind; personId?: string | null; organizationId?: string | null; limit?: number },
  viewer?: Viewer | null,
): SimilarCard[] {
  const scope = cardScope(db, viewer);
  const rows = many<{
    id: string;
    name: string;
    pipeline_id: string;
    pipeline_name: string;
    stage_name: string;
    status: DealStatus;
    person_id: string | null;
    organization_id: string | null;
    person_name: string | null;
    org_name: string | null;
  }>(
    db,
    `SELECT d.id, d.title AS name, d.pipeline_id, pi.name AS pipeline_name, s.name AS stage_name, d.status, d.person_id, d.organization_id,
       pe.name AS person_name, o.name AS org_name
     FROM deal d JOIN pipeline pi ON pi.id = d.pipeline_id JOIN stage s ON s.id = d.stage_id
     LEFT JOIN person pe ON pe.id = d.person_id LEFT JOIN organization o ON o.id = d.organization_id
     WHERE d.deleted_at IS NULL AND d.kind = ?${scope.sql}`,
    p.kind,
    ...scope.params,
  );
  const STATUS = { open: "Em aberto", won: "Encerrado", lost: "Encerrado" } as const;
  const out: SimilarCard[] = [];
  for (const r of rows) {
    const score = p.title.trim() ? nameSimilarity(p.title, r.name) : 0;
    // Mesmo contato/organização com cartão em aberto é forte sinal de duplicidade.
    const reason = isSimilar(score)
      ? "title"
      : r.status === "open" && p.personId && r.person_id === p.personId
        ? "person"
        : r.status === "open" && p.organizationId && r.organization_id === p.organizationId
          ? "organization"
          : null;
    if (!reason) continue;
    out.push({
      id: r.id,
      name: r.name,
      score: Math.round(score * 100),
      pipeline_id: r.pipeline_id,
      status: r.status,
      reason,
      details: compact([`${r.pipeline_name} › ${r.stage_name}`, STATUS[r.status], r.person_name, r.org_name]),
    });
  }
  return out
    .sort(
      (a, b) => Number(b.reason === "title") - Number(a.reason === "title") || b.score - a.score || Number(b.status === "open") - Number(a.status === "open"),
    )
    .slice(0, p.limit ?? 5);
}
