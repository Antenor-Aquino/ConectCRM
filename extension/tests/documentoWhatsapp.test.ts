import { describe, expect, it } from "vitest";
import { createActivity } from "../src/db/activities";
import { addCardContact } from "../src/db/cardContacts";
import { createOrganization, createPerson, linkPersonOrganization } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import { whatsappRecipients } from "../src/db/documents";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

describe("enviar documento pelo WhatsApp: destinatários", () => {
  it("contatos do cartão com celular, organização, contato e atividade", async () => {
    const { db, ctx } = await freshDb();
    const actx = { ...ctx, userId: createUser(db, ctx, { name: "Ana", role: "admin" }) };
    const escola = createOrganization(db, actx, { name: "EE Prof. José Borges", phone: "+558133334444" });
    const cris = createPerson(db, actx, { name: "Cristiane", phone: "+5581987298285" });
    const semFone = createPerson(db, actx, { name: "Diretor", email: "d@x.com" });
    const fin = createPerson(db, actx, { name: "Financeiro", phone: "+5581911112222" });
    linkPersonOrganization(db, actx, cris, escola);
    const p = createPipeline(db, actx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
    const card = createCard(db, actx, { pipelineId: p, title: "EE Prof. José Borges", personId: cris, organizationId: escola });
    addCardContact(db, actx, card, semFone);
    addCardContact(db, actx, card, fin);
    const names = (type: Parameters<typeof whatsappRecipients>[1], id: string) => whatsappRecipients(db, type, id).map((r) => `${r.name} (${r.role})`);
    expect(names("deal", card)).toEqual(["Cristiane (Contato principal)", "Financeiro (Outro contato do cartão)", "EE Prof. José Borges (Organização)"]);
    expect(names("person", semFone)).toEqual([]);
    expect(names("organization", escola)).toEqual(["EE Prof. José Borges (Organização)", "Cristiane (Contato da organização)"]);
    const act = createActivity(db, actx, { title: "Enviar contrato", dueAt: "2026-11-02T13:00:00.000Z", dealId: card });
    expect(names("activity", act)[0]).toBe("Cristiane (Contato principal)");
  });
});

describe("envio pelo WhatsApp vira atividade concluída", () => {
  it("no cartão, tipo WhatsApp, com o documento vinculado e a auditoria", async () => {
    const { listActivities, getActivity, listActivityTypes } = await import("../src/db/activities");
    const docs = await import("../src/db/documents");
    const { logWhatsAppSend } = await import("../src/db/whatsappLog");
    const { db, ctx } = await freshDb();
    const actx = { ...ctx, userId: createUser(db, ctx, { name: "Ana", role: "admin" }) };
    const cris = createPerson(db, actx, { name: "Cristiane", phone: "+5532991630146" });
    const p = createPipeline(db, actx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
    const card = createCard(db, actx, { pipelineId: p, title: "EE Amilcar Savassi", personId: cris });
    const type = docs.listDocumentTypes(db)[0]!.id;
    const doc = docs.createDocument(db, actx, {
      name: "CONTRATO",
      typeId: type,
      links: [{ type: "deal", id: card }],
      file: { sha256: "a".repeat(64), mime: "application/pdf", size: 10, filename: "CONTRATO.pdf", location: "browser" },
    });
    const send = () =>
      logWhatsAppSend(
        db,
        actx,
        {
          documentId: doc,
          context: { type: "deal", id: card },
          recipient: { kind: "person", id: cris, name: "Cristiane", phone: "+5532991630146" },
          from: "Comercial · (81) 98729-8285",
          caption: "Segue o contrato",
        },
        "(32) 99163-0146",
      );
    const id = send();
    const a = getActivity(db, id)!;
    expect(a).toMatchObject({ title: 'Enviou "CONTRATO" pelo WhatsApp para Cristiane', done: 1, deal_id: card, person_id: cris });
    expect(a.description).toBe("Para: Cristiane · (32) 99163-0146\nDe: Comercial · (81) 98729-8285\nMensagem: Segue o contrato");
    expect(a.reminders).toEqual([]);
    expect(listActivityTypes(db).find((t) => t.id === a.type_id)?.name).toBe("WhatsApp");
    expect(docs.documentsFor(db, "activity", id, null)).toEqual([]);
    expect(docs.documentAudit(db, doc).some((e) => e.text.includes("Enviou pelo WhatsApp para Cristiane"))).toBe(true);
    // Segundo envio reaproveita o tipo WhatsApp.
    send();
    expect(listActivityTypes(db).filter((t) => t.name === "WhatsApp")).toHaveLength(1);
    expect(listActivities(db, {}).filter((x) => x.deal_id === card)).toHaveLength(2);
  });
});

describe("envio pelo WhatsApp com revisão: pendente até sair", () => {
  it("prepara (pendente), confirma (concluída + auditoria) ou descarta (lixeira)", async () => {
    const { getActivity } = await import("../src/db/activities");
    const docs = await import("../src/db/documents");
    const wa = await import("../src/db/whatsappLog");
    const { restoreTrashItem } = await import("../src/db/trash");
    const { db, ctx } = await freshDb();
    const actx = { ...ctx, userId: createUser(db, ctx, { name: "Ana", role: "admin" }) };
    const lin = createPerson(db, actx, { name: "Lindendorf", phone: "+5531999990000" });
    const cam = createPerson(db, actx, { name: "Camila", phone: "+5532987010705" });
    const p = createPipeline(db, actx, { name: "Certificados", type: "comercial", stages: [{ name: "Proposta" }] });
    const card = createCard(db, actx, { pipelineId: p, title: "EE Amilcar Savassi", personId: lin });
    const type = docs.listDocumentTypes(db)[0]!.id;
    const doc = docs.createDocument(db, actx, {
      name: "Boleto",
      typeId: type,
      links: [{ type: "deal", id: card }],
      file: { sha256: "b".repeat(64), mime: "application/pdf", size: 10, filename: "Boleto.pdf", location: "browser" },
    });
    const prep = (id: string, name: string, phone: string) =>
      wa.prepareWhatsAppSend(
        db,
        actx,
        { documentId: doc, context: { type: "deal", id: card }, recipient: { kind: "person", id, name, phone }, caption: "Segue o boleto", senderId: "s1" },
        phone,
      );
    const a = prep(lin, "Lindendorf", "(31) 99999-0000");
    const b = prep(cam, "Camila", "(32) 98701-0705");
    expect(getActivity(db, a.activityId)).toMatchObject({ title: 'Enviar "Boleto" pelo WhatsApp para Lindendorf', done: 0, deal_id: card });
    expect(wa.listPendingWhatsAppSends(db, "deal", card).map((s) => s.recipient_name)).toEqual(["Lindendorf", "Camila"]);
    expect(docs.documentAudit(db, doc).some((e) => e.text.includes("WhatsApp"))).toBe(false);

    wa.confirmWhatsAppSend(db, actx, a.sendId, { phoneLabel: "(31) 99999-0000" });
    expect(getActivity(db, a.activityId)).toMatchObject({ title: 'Enviou "Boleto" pelo WhatsApp para Lindendorf', done: 1 });
    expect(getActivity(db, a.activityId)!.description).toBe("Para: Lindendorf · (31) 99999-0000\nMensagem: Segue o boleto");
    expect(docs.documentAudit(db, doc).filter((e) => e.text.includes("Enviou pelo WhatsApp"))).toHaveLength(1);
    // Confirmar de novo não duplica.
    wa.confirmWhatsAppSend(db, actx, a.sendId, { phoneLabel: "(31) 99999-0000" });
    expect(docs.documentAudit(db, doc).filter((e) => e.text.includes("Enviou pelo WhatsApp"))).toHaveLength(1);
    expect(wa.listPendingWhatsAppSends(db, "deal", card).map((s) => s.recipient_name)).toEqual(["Camila"]);

    const notice = wa.discardWhatsAppSend(db, actx, b.sendId);
    expect(getActivity(db, b.activityId)).toBeUndefined();
    expect(wa.listPendingWhatsAppSends(db, "deal", card)).toEqual([]);
    expect(() => wa.discardWhatsAppSend(db, actx, a.sendId)).toThrow(/já foi feito/);
    restoreTrashItem(db, actx, null, notice.ids[0]!);
    expect(wa.listPendingWhatsAppSends(db, "deal", card).map((s) => s.recipient_name)).toEqual(["Camila"]);
  });
});
