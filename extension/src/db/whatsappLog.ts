// Envio de documento pelo WhatsApp (spec 08): além da auditoria do documento,
// vira uma atividade concluída do tipo "WhatsApp" no cartão (ou no contato /
// organização), com o nome do documento no título — aparece na linha do tempo,
// na aba Atividades e nos relatórios.
// Com revisão (padrão), o envio é preparado antes: fica pendente (tabela
// whatsapp_send + atividade pendente) e só é concluído quando a mensagem sai.
import { createActivity, createActivityType, deleteActivity, listActivityTypes, updateActivity } from "./activities";
import { logDocumentEvent, type DocLinkType } from "./documents";
import { insertRow, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync } from "./sql";
import { ValidationError } from "../lib/validate";

/** Tipo "WhatsApp" (criado na primeira vez, com o ícone de conversa). */
export function whatsappActivityType(db: DatabaseSync, ctx: DbContext): string {
  const found = listActivityTypes(db, { includeInactive: true }).find((t) => t.name.trim().toLowerCase() === "whatsapp");
  return found?.id ?? createActivityType(db, ctx, { name: "WhatsApp", icon: "message-circle" });
}

export interface WhatsAppSendLog {
  documentId: string;
  /** Tela de onde foi enviado (o cartão, o contato...). */
  context: { type: DocLinkType; id: string };
  recipient: { kind: "person" | "organization"; id: string; name: string; phone: string };
  /** "Comercial · (81) 98729-8285" (número de origem), quando cadastrado. */
  from?: string | null;
  caption?: string | null;
  manual?: boolean;
}

/** Onde a atividade fica: o cartão da tela (ou o da atividade); sem cartão, o contato/organização. */
function placement(db: DatabaseSync, p: WhatsAppSendLog) {
  let dealId: string | null = null;
  let personId: string | null = p.recipient.kind === "person" ? p.recipient.id : null;
  let organizationId: string | null = p.recipient.kind === "organization" ? p.recipient.id : null;
  if (p.context.type === "deal") dealId = p.context.id;
  else if (p.context.type === "activity") {
    const a = one<{ deal_id: string | null; person_id: string | null; organization_id: string | null }>(
      db,
      "SELECT deal_id, person_id, organization_id FROM activity WHERE id = ?",
      p.context.id,
    );
    dealId = a?.deal_id ?? null;
    personId ??= a?.person_id ?? null;
    organizationId ??= a?.organization_id ?? null;
  } else if (p.context.type === "person") personId ??= p.context.id;
  else organizationId ??= p.context.id;
  return { dealId, personId, organizationId };
}

const docName = (db: DatabaseSync, id: string) => one<{ name: string }>(db, "SELECT name FROM document WHERE id = ?", id)?.name ?? "documento";

function sentDescription(to: string, from: string | null | undefined, manual: boolean | undefined, caption: string | null | undefined): string {
  return [
    `Para: ${to}`,
    from ? `De: ${from}${manual ? " (envio manual)" : ""}` : manual ? "Envio manual" : "",
    caption?.trim() ? `Mensagem: ${caption.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Registra o envio: auditoria do documento + atividade concluída. Devolve o id da atividade. */
export function logWhatsAppSend(db: DatabaseSync, ctx: DbContext, p: WhatsAppSendLog, phoneLabel: string): string {
  return withTransaction(db, () => {
    const to = `${p.recipient.name} · ${phoneLabel}`;
    logDocumentEvent(db, ctx, p.documentId, "whatsapp", `para ${to}${p.from ? ` · de ${p.from}` : ""}${p.manual ? " (envio manual)" : ""}`);
    const id = createActivity(db, ctx, {
      typeId: whatsappActivityType(db, ctx),
      title: `Enviou "${docName(db, p.documentId)}" pelo WhatsApp para ${p.recipient.name}`,
      description: sentDescription(to, p.from, p.manual, p.caption),
      dueAt: new Date().toISOString(),
      done: true,
      ownerId: ctx.userId,
      ...placement(db, p),
      reminders: [],
    });
    // O documento não é vinculado à atividade: cada envio viraria mais um "Também em" no documento.
    return id;
  });
}

// ---------- Envio pendente (revisão no WhatsApp Web / envio manual) ----------

export interface WhatsAppPending {
  id: string;
  activity_id: string;
  document_id: string;
  document_name: string;
  recipient_kind: "person" | "organization";
  recipient_id: string;
  recipient_name: string;
  recipient_phone: string;
  sender_id: string | null;
  from_label: string | null;
  caption: string | null;
  created_at: string;
}

/** Prepara o envio: atividade pendente + registro do envio. Ainda não entra na auditoria do documento. */
export function prepareWhatsAppSend(
  db: DatabaseSync,
  ctx: DbContext,
  p: WhatsAppSendLog & { senderId?: string | null },
  phoneLabel: string,
): { sendId: string; activityId: string } {
  return withTransaction(db, () => {
    const to = `${p.recipient.name} · ${phoneLabel}`;
    const activityId = createActivity(db, ctx, {
      typeId: whatsappActivityType(db, ctx),
      title: `Enviar "${docName(db, p.documentId)}" pelo WhatsApp para ${p.recipient.name}`,
      description: `${sentDescription(to, p.from, p.manual, p.caption)}\nPendente: o envio ainda não foi confirmado (aba Documentos → Enviar agora).`,
      dueAt: new Date().toISOString(),
      done: false,
      ownerId: ctx.userId,
      ...placement(db, p),
      reminders: [],
    });
    const sendId = insertRow(db, ctx, "whatsapp_send", {
      activity_id: activityId,
      document_id: p.documentId,
      context_type: p.context.type,
      context_id: p.context.id,
      recipient_kind: p.recipient.kind,
      recipient_id: p.recipient.id,
      recipient_name: p.recipient.name,
      recipient_phone: p.recipient.phone,
      sender_id: p.senderId ?? null,
      from_label: p.from ?? null,
      caption: p.caption?.trim() || null,
      status: "pending",
    });
    return { sendId, activityId };
  });
}

function getSend(db: DatabaseSync, id: string) {
  const s = one<WhatsAppPending & { status: string; context_type: DocLinkType; context_id: string }>(
    db,
    "SELECT * FROM whatsapp_send WHERE id = ? AND deleted_at IS NULL",
    id,
  );
  if (!s) throw new ValidationError("Envio não encontrado.");
  return s;
}

/** A mensagem saiu: atividade concluída (com a hora do envio) + auditoria do documento. */
export function confirmWhatsAppSend(
  db: DatabaseSync,
  ctx: DbContext,
  sendId: string,
  p: { phoneLabel: string; from?: string | null; senderId?: string | null; caption?: string | null; manual?: boolean },
): string {
  return withTransaction(db, () => {
    const s = getSend(db, sendId);
    if (s.status === "sent") return s.activity_id;
    const to = `${s.recipient_name} · ${p.phoneLabel}`;
    const from = p.from !== undefined ? p.from : s.from_label;
    const caption = p.caption !== undefined ? p.caption : s.caption;
    logDocumentEvent(db, ctx, s.document_id, "whatsapp", `para ${to}${from ? ` · de ${from}` : ""}${p.manual ? " (envio manual)" : ""}`);
    const now = new Date().toISOString();
    if (one(db, "SELECT id FROM activity WHERE id = ? AND deleted_at IS NULL", s.activity_id)) {
      updateActivity(db, ctx, s.activity_id, {
        title: `Enviou "${docName(db, s.document_id)}" pelo WhatsApp para ${s.recipient_name}`,
        description: sentDescription(to, from, p.manual, caption),
        dueAt: now,
        done: true,
      });
    }
    updateRow(db, ctx, "whatsapp_send", sendId, {
      status: "sent",
      sent_at: now,
      from_label: from ?? null,
      caption: caption?.trim() || null,
      ...(p.senderId !== undefined ? { sender_id: p.senderId } : {}),
    });
    return s.activity_id;
  });
}

/** Envios pendentes de uma tela (no cartão, também os preparados nas atividades dele). */
export function listPendingWhatsAppSends(db: DatabaseSync, type: DocLinkType, id: string): WhatsAppPending[] {
  return many<WhatsAppPending>(
    db,
    `SELECT s.id, s.activity_id, s.document_id, d.name AS document_name, s.recipient_kind, s.recipient_id, s.recipient_name,
            s.recipient_phone, s.sender_id, s.from_label, s.caption, s.created_at
       FROM whatsapp_send s
       JOIN activity a ON a.id = s.activity_id AND a.deleted_at IS NULL AND a.done = 0
       JOIN document d ON d.id = s.document_id AND d.deleted_at IS NULL
      WHERE s.status = 'pending' AND s.deleted_at IS NULL
        AND ((s.context_type = ? AND s.context_id = ?) OR (? = 'deal' AND a.deal_id = ?))
      ORDER BY s.created_at`,
    type,
    id,
    type,
    id,
  );
}

/** Desistiu do envio: a atividade pendente vai para a lixeira (dá para restaurar). */
export function discardWhatsAppSend(db: DatabaseSync, ctx: DbContext, sendId: string) {
  const s = getSend(db, sendId);
  if (s.status === "sent") throw new ValidationError("Este envio já foi feito.");
  return deleteActivity(db, ctx, s.activity_id);
}

export function whatsappSendContext(db: DatabaseSync, sendId: string): { type: DocLinkType; id: string; documentId: string } {
  const s = getSend(db, sendId);
  return { type: s.context_type, id: s.context_id, documentId: s.document_id };
}
