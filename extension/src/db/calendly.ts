// Calendly (spec 18): os agendamentos feitos pelo link do Calendly viram
// atividades "Reunião" no CRM. O vínculo agendamento ↔ atividade fica em
// external_ref (provider "calendly", entity_type "activity", external_id = URI
// do evento). Cartão: o do link (utm_content = id do cartão) ou, pelo e-mail
// do convidado, o único negócio aberto do contato; contato novo é cadastrado.
// Cancelado/remarcado no Calendly: a atividade fica concluída com o aviso no
// título (sai dos lembretes e continua no histórico).
import { createActivity, updateActivity } from "./activities";
import { createPerson, updatePerson } from "./contacts";
import { insertRow, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export interface CalendlyBooking {
  /** URI do evento agendado (único). */
  eventUri: string;
  status: "active" | "canceled";
  /** Nome do tipo de evento (ex.: "Reunião 30 min"). */
  eventName: string;
  start: string;
  end: string;
  joinUrl: string | null;
  /** E-mail da conta Calendly que recebeu o agendamento. */
  account: string;
  invitee: {
    name: string;
    email: string;
    phone: string | null;
    /** utm_content do link enviado pelo CRM. */
    dealId: string | null;
    answers: { q: string; a: string }[];
    rescheduled?: boolean;
    cancelReason?: string | null;
  };
}

export interface CalendlyImportResult {
  created: number;
  updated: number;
  canceled: number;
  items: { kind: "created" | "updated" | "canceled"; title: string; when: string }[];
}

const CANCELED_PREFIX = "Cancelada: ";
const RESCHEDULED_PREFIX = "Remarcada: ";

function meetingTypeId(db: DatabaseSync): string | undefined {
  return one<{ id: string }>(db, "SELECT id FROM activity_type WHERE is_meeting = 1 AND deleted_at IS NULL ORDER BY position LIMIT 1")?.id;
}

function findPerson(db: DatabaseSync, email: string): string | null {
  if (!email) return null;
  return one<{ id: string }>(db, "SELECT id FROM person WHERE lower(email) = lower(?) AND deleted_at IS NULL ORDER BY created_at LIMIT 1", email)?.id ?? null;
}

/** Cartão do agendamento: o do link; senão o único cartão aberto do contato. */
function findDeal(db: DatabaseSync, dealId: string | null, personId: string | null): string | null {
  if (dealId && one(db, "SELECT 1 FROM deal WHERE id = ? AND deleted_at IS NULL", dealId)) return dealId;
  if (!personId) return null;
  const open = many<{ id: string }>(
    db,
    `SELECT DISTINCT d.id FROM deal d LEFT JOIN deal_participant dp ON dp.deal_id = d.id AND dp.deleted_at IS NULL
     WHERE d.deleted_at IS NULL AND d.archived_at IS NULL AND d.status = 'open' AND (d.person_id = ? OR dp.person_id = ?)`,
    personId,
    personId,
  );
  return open.length === 1 ? open[0]!.id : null;
}

function describe(b: CalendlyBooking): string {
  const lines = [`Agendado pelo Calendly (${b.account}) por ${b.invitee.name}${b.invitee.email ? ` <${b.invitee.email}>` : ""}.`];
  for (const qa of b.invitee.answers) if (qa.a) lines.push(`${qa.q}: ${qa.a}`);
  return lines.join("\n");
}

const minutesBetween = (a: string, b: string) => Math.max(5, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

/** Importa (cria/atualiza/cancela) os agendamentos. Repetir a mesma lista não duplica nada. */
export function importCalendlyBookings(db: DatabaseSync, ctx: DbContext, bookings: CalendlyBooking[]): CalendlyImportResult {
  const out: CalendlyImportResult = { created: 0, updated: 0, canceled: 0, items: [] };
  withTransaction(db, () => {
    for (const b of bookings) {
      const ref = one<{ id: string; local_id: string }>(
        db,
        "SELECT id, local_id FROM external_ref WHERE provider = 'calendly' AND entity_type = 'activity' AND external_id = ? AND deleted_at IS NULL",
        b.eventUri,
      );
      const act = ref ? one<{ id: string; title: string; due_at: string; done: number }>(db, "SELECT id, title, due_at, done FROM activity WHERE id = ? AND deleted_at IS NULL", ref.local_id) : undefined;
      if (b.status === "canceled") {
        // Cancelado antes de o CRM ver: nada a fazer.
        if (!act || act.title.startsWith(CANCELED_PREFIX) || act.title.startsWith(RESCHEDULED_PREFIX)) continue;
        const prefix = b.invitee.rescheduled ? RESCHEDULED_PREFIX : CANCELED_PREFIX;
        updateActivity(db, ctx, act.id, { title: prefix + act.title, done: true });
        out.canceled++;
        out.items.push({ kind: "canceled", title: prefix + act.title, when: b.start });
        continue;
      }
      if (act) {
        if (act.due_at !== new Date(b.start).toISOString()) {
          updateActivity(db, ctx, act.id, { dueAt: b.start, durationMin: minutesBetween(b.start, b.end) });
          out.updated++;
          out.items.push({ kind: "updated", title: act.title, when: b.start });
        }
        continue;
      }
      if (ref) continue; // atividade excluída no CRM: não volta.
      let personId = findPerson(db, b.invitee.email);
      if (!personId && (b.invitee.name || b.invitee.email)) {
        const base = { name: b.invitee.name || b.invitee.email, email: b.invitee.email || null };
        try {
          personId = createPerson(db, ctx, { ...base, phone: b.invitee.phone || null });
        } catch {
          personId = createPerson(db, ctx, base); // telefone em formato que o CRM não aceita
        }
      } else if (personId && b.invitee.phone && !one(db, "SELECT 1 FROM person WHERE id = ? AND phone IS NOT NULL AND phone <> ''", personId)) {
        try {
          updatePerson(db, ctx, personId, { phone: b.invitee.phone });
        } catch {
          /* telefone em formato que o CRM não aceita: fica de fora */
        }
      }
      const dealId = findDeal(db, b.invitee.dealId, personId);
      const title = `${b.eventName} — ${b.invitee.name || b.invitee.email}`;
      const id = createActivity(db, ctx, {
        typeId: meetingTypeId(db),
        title,
        description: describe(b),
        dueAt: b.start,
        durationMin: minutesBetween(b.start, b.end),
        dealId,
        personId: dealId ? undefined : personId,
        meetingUrl: b.joinUrl,
        ownerId: ctx.userId,
      });
      // Cartão sem contato principal: o convidado é o contato da reunião.
      if (dealId && personId) updateRow(db, ctx, "activity", id, { person_id: personId });
      insertRow(db, ctx, "external_ref", {
        provider: "calendly",
        entity_type: "activity",
        external_id: b.eventUri,
        local_id: id,
        source_updated_at: null,
        imported_at: new Date().toISOString(),
      });
      out.created++;
      out.items.push({ kind: "created", title, when: b.start });
    }
  });
  return out;
}
