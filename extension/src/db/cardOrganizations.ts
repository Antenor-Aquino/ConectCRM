// Organizações do cartão: a principal (deal.organization_id) e outras com um
// papel (deal_org_link): quem paga (ex.: o Caixa Escolar da escola), a
// mantenedora, outras escolas/unidades da rede ou outra relação. Cobrança,
// NFS-e (tomador) e Gestão Financeira usam a pagadora, se houver.
import { ValidationError } from "../lib/validate";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export type CardOrgRole = "cliente" | "pagador" | "mantenedora" | "outra";
export const CARD_ORG_ROLES: CardOrgRole[] = ["pagador", "mantenedora", "cliente", "outra"];
export const CARD_ORG_ROLE_LABEL: Record<CardOrgRole | "principal", string> = {
  principal: "Principal",
  pagador: "Pagador",
  mantenedora: "Mantenedora",
  cliente: "Unidade / escola",
  outra: "Outra",
};

export interface CardOrganization {
  id: string;
  name: string;
  legal_name: string | null;
  cnpj: string | null;
  city: string | null;
  state: string | null;
  /** "principal" = deal.organization_id. */
  role: CardOrgRole | "principal";
  /** É quem paga (pagador; sem pagador, a principal). */
  is_payer: number;
}

const isRole = (r: unknown): r is CardOrgRole => typeof r === "string" && (CARD_ORG_ROLES as string[]).includes(r);

function linkRow(db: DatabaseSync, dealId: string, orgId: string) {
  return one<{ id: string; role: CardOrgRole }>(db, "SELECT id, role FROM deal_org_link WHERE deal_id = ? AND organization_id = ? AND deleted_at IS NULL", dealId, orgId);
}

/** Principal primeiro; depois pagador, mantenedora, unidades e outras (na ordem em que foram vinculadas). */
export function listCardOrganizations(db: DatabaseSync, dealId: string): CardOrganization[] {
  const payer = payerOrganizationId(db, dealId);
  return many<Omit<CardOrganization, "is_payer">>(
    db,
    `SELECT o.id, o.name, o.legal_name, o.cnpj, o.city, o.state, x.role FROM (
       SELECT organization_id, 'principal' AS role, 0 AS ord, '' AS at FROM deal WHERE id = ? AND organization_id IS NOT NULL
       UNION ALL
       SELECT organization_id, role, CASE role WHEN 'pagador' THEN 1 WHEN 'mantenedora' THEN 2 WHEN 'cliente' THEN 3 ELSE 4 END, created_at
       FROM deal_org_link WHERE deal_id = ? AND deleted_at IS NULL
     ) x JOIN organization o ON o.id = x.organization_id AND o.deleted_at IS NULL
     ORDER BY x.ord, x.at`,
    dealId,
    dealId,
  ).map((o) => ({ ...o, is_payer: o.id === payer ? 1 : 0 }));
}

/** Quem paga: a organização marcada como pagadora; sem ela, a principal. */
export function payerOrganizationId(db: DatabaseSync, dealId: string): string | null {
  const p = one<{ organization_id: string }>(
    db,
    `SELECT l.organization_id FROM deal_org_link l JOIN organization o ON o.id = l.organization_id AND o.deleted_at IS NULL
     WHERE l.deal_id = ? AND l.role = 'pagador' AND l.deleted_at IS NULL ORDER BY l.created_at LIMIT 1`,
    dealId,
  );
  return p?.organization_id ?? one<{ organization_id: string | null }>(db, "SELECT organization_id FROM deal WHERE id = ?", dealId)?.organization_id ?? null;
}

/** Só um pagador por cartão: o anterior vira "Outra". */
function clearOtherPayers(db: DatabaseSync, ctx: DbContext, dealId: string, exceptOrgId: string) {
  for (const r of many<{ id: string }>(db, "SELECT id FROM deal_org_link WHERE deal_id = ? AND role = 'pagador' AND organization_id <> ? AND deleted_at IS NULL", dealId, exceptOrgId))
    updateRow(db, ctx, "deal_org_link", r.id, { role: "outra" });
}

/** Vincula mais uma organização. Sem principal, ela vira a principal (exceto pagador/mantenedora, que ficam com o papel). */
export function addCardOrganization(db: DatabaseSync, ctx: DbContext, dealId: string, orgId: string, role: CardOrgRole = "outra"): void {
  if (!isRole(role)) throw new ValidationError("Papel da organização inválido.");
  withTransaction(db, () => {
    const deal = getRow(db, "deal", dealId) as { organization_id: string | null } | undefined;
    if (!deal) throw new ValidationError("Cartão não encontrado.");
    if (!getRow(db, "organization", orgId)) throw new ValidationError("Organização não encontrada.");
    if (deal.organization_id === orgId) return;
    const cur = linkRow(db, dealId, orgId);
    if (cur) {
      if (cur.role !== role) setCardOrganizationRole(db, ctx, dealId, orgId, role);
      return;
    }
    if (!deal.organization_id && (role === "cliente" || role === "outra")) {
      updateRow(db, ctx, "deal", dealId, { organization_id: orgId });
      return;
    }
    if (role === "pagador") clearOtherPayers(db, ctx, dealId, orgId);
    insertRow(db, ctx, "deal_org_link", { deal_id: dealId, organization_id: orgId, role });
  });
}

/** Muda o papel de uma organização vinculada (a principal não tem papel: troque a principal). */
export function setCardOrganizationRole(db: DatabaseSync, ctx: DbContext, dealId: string, orgId: string, role: CardOrgRole): void {
  if (!isRole(role)) throw new ValidationError("Papel da organização inválido.");
  withTransaction(db, () => {
    const row = linkRow(db, dealId, orgId);
    if (!row) throw new ValidationError("Esta organização não está vinculada ao cartão (ou é a principal).");
    if (role === "pagador") clearOtherPayers(db, ctx, dealId, orgId);
    if (row.role !== role) updateRow(db, ctx, "deal_org_link", row.id, { role });
  });
}

/** Desvincula. Saindo a principal, a próxima unidade/outra assume (pagador e mantenedora continuam com o papel). */
export function removeCardOrganization(db: DatabaseSync, ctx: DbContext, dealId: string, orgId: string): void {
  withTransaction(db, () => {
    const deal = getRow(db, "deal", dealId) as { organization_id: string | null } | undefined;
    if (!deal) throw new ValidationError("Cartão não encontrado.");
    const row = linkRow(db, dealId, orgId);
    if (row) return softDelete(db, ctx, "deal_org_link", row.id);
    if (deal.organization_id !== orgId) return;
    const next = one<{ id: string; organization_id: string }>(
      db,
      `SELECT id, organization_id FROM deal_org_link WHERE deal_id = ? AND deleted_at IS NULL AND role IN ('cliente', 'outra')
       ORDER BY role = 'cliente' DESC, created_at LIMIT 1`,
      dealId,
    );
    if (next) softDelete(db, ctx, "deal_org_link", next.id);
    updateRow(db, ctx, "deal", dealId, { organization_id: next?.organization_id ?? null });
  });
}

/** Troca a principal: a atual passa a "Unidade / escola" (ou mantém o papel, se já estava vinculada). */
export function setPrimaryCardOrganization(db: DatabaseSync, ctx: DbContext, dealId: string, orgId: string): void {
  withTransaction(db, () => {
    const deal = getRow(db, "deal", dealId) as { organization_id: string | null } | undefined;
    if (!deal) throw new ValidationError("Cartão não encontrado.");
    if (deal.organization_id === orgId) return;
    if (!getRow(db, "organization", orgId)) throw new ValidationError("Organização não encontrada.");
    const row = linkRow(db, dealId, orgId);
    if (row) softDelete(db, ctx, "deal_org_link", row.id);
    if (deal.organization_id && !linkRow(db, dealId, deal.organization_id))
      insertRow(db, ctx, "deal_org_link", { deal_id: dealId, organization_id: deal.organization_id, role: "cliente" });
    updateRow(db, ctx, "deal", dealId, { organization_id: orgId });
  });
}

/** Organização virou principal por outro caminho (edição do cartão): sai das vinculadas. */
export function dropLinkIfPrimary(db: DatabaseSync, ctx: DbContext, dealId: string, orgId: string | null): void {
  if (!orgId) return;
  const row = linkRow(db, dealId, orgId);
  if (row) softDelete(db, ctx, "deal_org_link", row.id);
}

/** Clonar o cartão: as outras organizações vão junto, com o mesmo papel. */
export function copyCardOrganizations(db: DatabaseSync, ctx: DbContext, fromId: string, toId: string): void {
  for (const o of listCardOrganizations(db, fromId)) if (o.role !== "principal") addCardOrganization(db, ctx, toId, o.id, o.role);
}
