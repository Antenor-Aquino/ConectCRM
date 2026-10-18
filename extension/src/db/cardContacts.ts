// Contatos do cartão: o principal (deal.person_id) e outros contatos
// envolvidos (deal_participant), como decisor, financeiro ou técnico.
import { ValidationError } from "../lib/validate";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export interface CardContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organization_name: string | null;
  is_primary: number;
}

/** Principal primeiro, depois os demais na ordem em que foram vinculados. */
export function listCardContacts(db: DatabaseSync, dealId: string): CardContact[] {
  return many<CardContact>(
    db,
    `SELECT p.id, p.name, p.email, p.phone, o.name AS organization_name, x.is_primary FROM (
       SELECT person_id, 1 AS is_primary, '' AS at FROM deal WHERE id = ? AND person_id IS NOT NULL
       UNION ALL
       SELECT person_id, 0, created_at FROM deal_participant WHERE deal_id = ? AND person_id IS NOT NULL AND deleted_at IS NULL
     ) x JOIN person p ON p.id = x.person_id AND p.deleted_at IS NULL
     LEFT JOIN person_organization po ON po.person_id = p.id AND po.is_primary = 1 AND po.deleted_at IS NULL
     LEFT JOIN organization o ON o.id = po.organization_id AND o.deleted_at IS NULL
     ORDER BY x.is_primary DESC, x.at`,
    dealId,
    dealId,
  );
}

function participantRow(db: DatabaseSync, dealId: string, personId: string) {
  return one<{ id: string }>(db, "SELECT id FROM deal_participant WHERE deal_id = ? AND person_id = ? AND deleted_at IS NULL", dealId, personId);
}

/** Vincula mais um contato. Sem contato principal, ele vira o principal. */
export function addCardContact(db: DatabaseSync, ctx: DbContext, dealId: string, personId: string): void {
  withTransaction(db, () => {
    const deal = getRow(db, "deal", dealId) as { person_id: string | null } | undefined;
    if (!deal) throw new ValidationError("Cartão não encontrado.");
    if (!getRow(db, "person", personId)) throw new ValidationError("Contato não encontrado.");
    if (deal.person_id === personId || participantRow(db, dealId, personId)) return;
    if (!deal.person_id) updateRow(db, ctx, "deal", dealId, { person_id: personId });
    else insertRow(db, ctx, "deal_participant", { deal_id: dealId, person_id: personId });
  });
}

/** Desvincula. Saindo o principal, o próximo contato (se houver) assume. */
export function removeCardContact(db: DatabaseSync, ctx: DbContext, dealId: string, personId: string): void {
  withTransaction(db, () => {
    const deal = getRow(db, "deal", dealId) as { person_id: string | null } | undefined;
    if (!deal) throw new ValidationError("Cartão não encontrado.");
    const row = participantRow(db, dealId, personId);
    if (row) return softDelete(db, ctx, "deal_participant", row.id);
    if (deal.person_id !== personId) return;
    const next = one<{ id: string; person_id: string }>(
      db,
      "SELECT id, person_id FROM deal_participant WHERE deal_id = ? AND person_id IS NOT NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
      dealId,
    );
    if (next) softDelete(db, ctx, "deal_participant", next.id);
    updateRow(db, ctx, "deal", dealId, { person_id: next?.person_id ?? null });
  });
}

/** Troca o principal: o atual passa para "outros contatos". */
export function setPrimaryCardContact(db: DatabaseSync, ctx: DbContext, dealId: string, personId: string): void {
  withTransaction(db, () => {
    const deal = getRow(db, "deal", dealId) as { person_id: string | null } | undefined;
    if (!deal) throw new ValidationError("Cartão não encontrado.");
    if (deal.person_id === personId) return;
    if (!getRow(db, "person", personId)) throw new ValidationError("Contato não encontrado.");
    const row = participantRow(db, dealId, personId);
    if (row) softDelete(db, ctx, "deal_participant", row.id);
    if (deal.person_id && !participantRow(db, dealId, deal.person_id)) insertRow(db, ctx, "deal_participant", { deal_id: dealId, person_id: deal.person_id });
    updateRow(db, ctx, "deal", dealId, { person_id: personId });
  });
}

/** Cópia dos outros contatos (clonar cartão). */
export function copyCardContacts(db: DatabaseSync, ctx: DbContext, fromId: string, toId: string): void {
  for (const c of listCardContacts(db, fromId).filter((x) => !x.is_primary)) addCardContact(db, ctx, toId, c.id);
}
