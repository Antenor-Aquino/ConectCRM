// Envio de documento pelo WhatsApp (spec 08): além da auditoria do documento,
// vira uma atividade concluída do tipo "WhatsApp" no cartão (ou no contato /
// organização), com o nome do documento no título — aparece na linha do tempo,
// na aba Atividades e nos relatórios.
import { createActivity, createActivityType, listActivityTypes } from "./activities";
import { logDocumentEvent, type DocLinkType } from "./documents";
import type { DbContext } from "./repo";
import { one, withTransaction, type DatabaseSync } from "./sql";

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

/** Registra o envio: auditoria do documento + atividade concluída. Devolve o id da atividade. */
export function logWhatsAppSend(db: DatabaseSync, ctx: DbContext, p: WhatsAppSendLog, phoneLabel: string): string {
  return withTransaction(db, () => {
    const doc = one<{ name: string }>(db, "SELECT name FROM document WHERE id = ?", p.documentId);
    const to = `${p.recipient.name} · ${phoneLabel}`;
    logDocumentEvent(db, ctx, p.documentId, "whatsapp", `para ${to}${p.from ? ` · de ${p.from}` : ""}${p.manual ? " (envio manual)" : ""}`);

    // Onde a atividade fica: o cartão da tela (ou o da atividade); sem cartão, o contato/organização.
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

    const id = createActivity(db, ctx, {
      typeId: whatsappActivityType(db, ctx),
      title: `Enviou "${doc?.name ?? "documento"}" pelo WhatsApp para ${p.recipient.name}`,
      description: [
        `Para: ${to}`,
        p.from ? `De: ${p.from}${p.manual ? " (envio manual)" : ""}` : p.manual ? "Envio manual" : "",
        p.caption?.trim() ? `Mensagem: ${p.caption.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      dueAt: new Date().toISOString(),
      done: true,
      ownerId: ctx.userId,
      dealId,
      personId,
      organizationId,
      reminders: [],
    });
    // O documento não é vinculado à atividade: cada envio viraria mais um "Também em" no documento.
    return id;
  });
}
