// Lembrete para o contato por WhatsApp (spec 10, 0.2.69): uma mensagem por
// atividade, enviada X minutos antes do início pela extensão (Z-API ou
// WhatsApp Web), com o Chrome aberto — mesmo com o CRM fechado. Editável até
// sair. Se o Chrome estava fechado na hora, sai quando ele abrir, desde que a
// atividade ainda não tenha começado; senão fica "não enviada" e o usuário é
// avisado. O envio vira nota na atividade e no contato.
import { renderContactMessage, type ContactVars } from "../lib/notify/contactMessage";
import { nowIso } from "../lib/ids";
import { ValidationError } from "../lib/validate";
import { listCardContacts } from "./cardContacts";
import { addNote } from "./notes";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export type ContactMessageStatus = "pending" | "sent" | "failed" | "skipped" | "canceled";

export interface ContactMessageInput {
  personId: string;
  minutesBefore: number;
  template: string;
  /** Número de origem (Configurações → WhatsApp: Z-API ou WhatsApp Web). */
  senderId?: string | null;
}

export interface ContactMessage {
  id: string;
  activity_id: string;
  person_id: string;
  minutes_before: number;
  template: string;
  sender_id: string | null;
  status: ContactMessageStatus;
  sent_at: string | null;
  sent_text: string | null;
  error: string | null;
  created_by: string | null;
}

export interface ContactRecipient {
  id: string;
  name: string;
  phone: string | null;
}

/** Quem pode receber: o contato da atividade e os contatos do cartão vinculado (com ou sem celular). */
export function contactRecipients(db: DatabaseSync, p: { personId?: string | null; dealId?: string | null }): ContactRecipient[] {
  const out = new Map<string, ContactRecipient>();
  if (p.personId) {
    const r = one<ContactRecipient>(db, "SELECT id, name, phone FROM person WHERE id = ? AND deleted_at IS NULL", p.personId);
    if (r) out.set(r.id, r);
  }
  if (p.dealId) for (const c of listCardContacts(db, p.dealId)) if (!out.has(c.id)) out.set(c.id, { id: c.id, name: c.name, phone: c.phone });
  return [...out.values()];
}

/** Empresa do funil do cartão (assina a mensagem). */
export function companyForDeal(db: DatabaseSync, dealId: string | null | undefined): string | null {
  if (!dealId) return null;
  return one<{ c: string | null }>(db, "SELECT p.company_name AS c FROM deal d JOIN pipeline p ON p.id = d.pipeline_id WHERE d.id = ?", dealId)?.c ?? null;
}

export function getContactMessage(db: DatabaseSync, activityId: string): ContactMessage | undefined {
  return one<ContactMessage>(
    db,
    `SELECT id, activity_id, person_id, minutes_before, template, sender_id, status, sent_at, sent_text, error, created_by
     FROM activity_contact_message WHERE activity_id = ? AND deleted_at IS NULL`,
    activityId,
  );
}

function checkInput(db: DatabaseSync, input: ContactMessageInput): void {
  const p = one<{ name: string; phone: string | null }>(db, "SELECT name, phone FROM person WHERE id = ? AND deleted_at IS NULL", input.personId);
  if (!p) throw new ValidationError("Contato não encontrado.");
  if (!p.phone) throw new ValidationError(`${p.name} não tem celular (WhatsApp) cadastrado. Cadastre o celular no contato para enviar o lembrete.`);
  if (!Number.isInteger(input.minutesBefore) || input.minutesBefore < 0 || input.minutesBefore > 60 * 24 * 30) throw new ValidationError("Antecedência do lembrete inválida.");
  if (!input.template.trim()) throw new ValidationError("Escreva a mensagem do lembrete.");
  if (input.template.length > 2000) throw new ValidationError("A mensagem do lembrete é longa demais (máx. 2.000 caracteres).");
}

/**
 * Liga, altera (até sair) ou desliga (`null`) o lembrete do contato de uma
 * atividade. Já enviado: não muda mais. Não enviado (erro ou passou da hora):
 * salvar de novo volta a agendar.
 */
export function setContactMessage(db: DatabaseSync, ctx: DbContext, activityId: string, input: ContactMessageInput | null): void {
  withTransaction(db, () => {
    if (!one(db, "SELECT 1 FROM activity WHERE id = ? AND deleted_at IS NULL", activityId)) throw new ValidationError("Atividade não encontrada.");
    const cur = getContactMessage(db, activityId);
    if (cur?.status === "sent") {
      if (input === null) return;
      const same = cur.person_id === input.personId && cur.minutes_before === input.minutesBefore && cur.template === input.template && cur.sender_id === (input.senderId ?? null);
      if (same) return;
      throw new ValidationError("O lembrete para o contato já foi enviado e não pode mais ser alterado.");
    }
    if (input === null) {
      if (cur) softDelete(db, ctx, "activity_contact_message", cur.id);
      return;
    }
    checkInput(db, input);
    const data = {
      person_id: input.personId,
      minutes_before: input.minutesBefore,
      template: input.template,
      sender_id: input.senderId ?? null,
      status: "pending",
      error: null,
    };
    if (cur) updateRow(db, ctx, "activity_contact_message", cur.id, data);
    else insertRow(db, ctx, "activity_contact_message", { activity_id: activityId, ...data });
  });
}

interface DueRow extends ContactMessage {
  due_at: string;
  done: number;
  title: string;
  meeting_url: string | null;
  deal_id: string | null;
  person_name: string;
  phone: string | null;
  owner_name: string | null;
  creator_name: string | null;
}

const DUE_SQL = `SELECT m.id, m.activity_id, m.person_id, m.minutes_before, m.template, m.sender_id, m.status, m.sent_at, m.sent_text, m.error, m.created_by,
    a.due_at, a.done, a.title, a.meeting_url, a.deal_id, p.name AS person_name, p.phone,
    ow.name AS owner_name, cu.name AS creator_name
  FROM activity_contact_message m
  JOIN activity a ON a.id = m.activity_id AND a.deleted_at IS NULL
  JOIN person p ON p.id = m.person_id
  LEFT JOIN app_user ow ON ow.id = a.owner_id
  LEFT JOIN app_user cu ON cu.id = m.created_by
  WHERE m.deleted_at IS NULL`;

function varsOf(db: DatabaseSync, r: DueRow): ContactVars {
  return {
    personName: r.person_name,
    start: new Date(r.due_at),
    link: r.meeting_url,
    activityTitle: r.title,
    myName: r.owner_name ?? r.creator_name ?? "",
    company: companyForDeal(db, r.deal_id),
  };
}

/** Quando sai (ISO). */
export const sendAtOf = (dueAt: string, minutesBefore: number) => new Date(new Date(dueAt).getTime() - minutesBefore * 60_000).toISOString();

export interface ContactSendJob {
  id: string;
  activityId: string;
  title: string;
  personName: string;
  phone: string;
  senderId: string | null;
  /** Usuário que agendou (os números de origem são dele). */
  userId: string | null;
  text: string;
}

/**
 * O que enviar agora. Na mesma passada: atividade concluída → cancela;
 * passou da hora com a atividade já começada → "não enviada" (vai em `missed`).
 */
export function dueContactMessages(db: DatabaseSync, ctx: DbContext, now = new Date()): { jobs: ContactSendJob[]; missed: { title: string; personName: string }[] } {
  const jobs: ContactSendJob[] = [];
  const missed: { title: string; personName: string }[] = [];
  for (const r of many<DueRow>(db, `${DUE_SQL} AND m.status = 'pending'`)) {
    if (r.done) {
      updateRow(db, ctx, "activity_contact_message", r.id, { status: "canceled", error: "A atividade foi concluída antes do envio." });
      continue;
    }
    if (new Date(sendAtOf(r.due_at, r.minutes_before)) > now) continue;
    if (new Date(r.due_at) <= now) {
      updateRow(db, ctx, "activity_contact_message", r.id, {
        status: "skipped",
        error: "O Chrome estava fechado na hora do envio e a atividade já tinha começado quando ele abriu.",
      });
      missed.push({ title: r.title, personName: r.person_name });
      continue;
    }
    if (!r.phone) {
      updateRow(db, ctx, "activity_contact_message", r.id, { status: "failed", error: "O contato não tem mais celular cadastrado." });
      missed.push({ title: r.title, personName: r.person_name });
      continue;
    }
    jobs.push({
      id: r.id,
      activityId: r.activity_id,
      title: r.title,
      personName: r.person_name,
      phone: r.phone,
      senderId: r.sender_id,
      userId: r.created_by,
      text: renderContactMessage(r.template, varsOf(db, r), now),
    });
  }
  return { jobs, missed };
}

/** Resultado do envio; enviado vira nota na atividade e no contato. */
export function recordContactMessage(db: DatabaseSync, ctx: DbContext, id: string, result: { ok: boolean; text?: string; error?: string }): void {
  withTransaction(db, () => {
    const r = one<DueRow>(db, `${DUE_SQL} AND m.id = ?`, id);
    if (!r || r.status !== "pending") return;
    if (!result.ok) {
      updateRow(db, ctx, "activity_contact_message", id, { status: "failed", error: result.error ?? "Falha no envio." });
      return;
    }
    const at = nowIso();
    updateRow(db, ctx, "activity_contact_message", id, { status: "sent", sent_at: at, sent_text: result.text ?? null, error: null });
    const hm = new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const body = `<p>📲 Lembrete enviado por WhatsApp para ${esc(r.person_name)} às ${hm}:</p><p>${esc(result.text ?? "").replace(/\n/g, "<br>")}</p>`;
    addNote(db, ctx, "activity", r.activity_id, body);
    addNote(db, ctx, "person", r.person_id, body);
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Para a tela: situação e prévia do texto (com os dados atuais). */
export function contactMessagePreview(db: DatabaseSync, activityId: string): (ContactMessage & { send_at: string; preview: string; person_name: string; phone: string | null }) | null {
  const r = one<DueRow>(db, `${DUE_SQL} AND m.activity_id = ?`, activityId);
  if (!r) return null;
  const sendAt = sendAtOf(r.due_at, r.minutes_before);
  return { ...r, send_at: sendAt, preview: r.sent_text ?? renderContactMessage(r.template, varsOf(db, r), new Date(sendAt)), person_name: r.person_name, phone: r.phone };
}
