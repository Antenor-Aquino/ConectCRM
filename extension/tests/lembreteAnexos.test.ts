// Lembrete do contato com anexos do GED: escolhidos, "todos da atividade",
// limite, auditoria do documento e nota com os anexos.
import { describe, expect, it } from "vitest";
import { createActivity } from "../src/db/activities";
import { createPerson } from "../src/db/contacts";
import * as cm from "../src/db/contactMessages";
import { createDocument, listDocumentTypes, trashDocument } from "../src/db/documents";
import { listNotes } from "../src/db/notes";
import { many } from "../src/db/sql";
import { createUser } from "../src/db/users";
import { CONTACT_TEMPLATE_DEFAULT } from "../src/lib/notify/contactMessage";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const maria = createPerson(db, ctx, { name: "Maria José", phone: "+5511987654321" });
  const a = createActivity(db, ctx, { title: "Reunião", dueAt: "2026-10-22T10:00:00", personId: maria });
  const doc = (name: string, ch: string, linked = true) =>
    createDocument(db, ctx, {
      name,
      typeId: listDocumentTypes(db)[0]!.id,
      links: linked ? [{ type: "activity", id: a }] : [],
      file: { sha256: ch.repeat(64), mime: "application/pdf", size: 3, filename: `${name}.pdf`, location: "browser" },
    });
  return { db, ctx, maria, a, doc };
}
const msg = (personId: string, attachments?: cm.ContactAttachments): cm.ContactMessageInput => ({
  personId,
  minutesBefore: 60,
  template: CONTACT_TEMPLATE_DEFAULT,
  senderId: "zapi-1",
  attachments,
});
const at9 = new Date("2026-10-22T09:00:00");

describe("lembrete do contato com anexos", () => {
  it("sem anexos: só texto (como antes)", async () => {
    const { db, ctx, maria, a } = await setup();
    cm.setContactMessage(db, ctx, a, msg(maria));
    expect(cm.dueContactMessages(db, ctx, at9).jobs[0]!.files).toEqual([]);
  });

  it("documentos escolhidos, na ordem escolhida, com a versão atual", async () => {
    const { db, ctx, maria, a, doc } = await setup();
    const p = doc("Proposta", "a");
    const c = doc("Contrato", "b");
    cm.setContactMessage(db, ctx, a, msg(maria, [c, p]));
    expect(cm.parseAttachments(cm.getContactMessage(db, a)!.attachments)).toEqual([c, p]);
    const files = cm.dueContactMessages(db, ctx, at9).jobs[0]!.files;
    expect(files.map((f) => f.name)).toEqual(["Contrato", "Proposta"]);
    expect(files.every((f) => f.versionId)).toBe(true);
  });

  it('"all": todos os documentos da atividade na hora do envio (anexados depois de salvar)', async () => {
    const { db, ctx, maria, a, doc } = await setup();
    cm.setContactMessage(db, ctx, a, msg(maria, "all"));
    doc("Proposta", "a");
    doc("Outro", "c", false);
    expect(cm.dueContactMessages(db, ctx, at9).jobs[0]!.files.map((f) => f.name)).toEqual(["Proposta"]);
  });

  it("documento apagado depois de escolhido não vai; limite de 5; documento inexistente recusado", async () => {
    const { db, ctx, maria, a, doc } = await setup();
    const p = doc("Proposta", "a");
    const c = doc("Contrato", "b");
    cm.setContactMessage(db, ctx, a, msg(maria, [p, c]));
    trashDocument(db, ctx, c);
    expect(cm.dueContactMessages(db, ctx, at9).jobs[0]!.files.map((f) => f.name)).toEqual(["Proposta"]);
    expect(() => cm.setContactMessage(db, ctx, a, msg(maria, ["x1", "x2", "x3", "x4", "x5", "x6"]))).toThrow(/até 5/);
    expect(() => cm.setContactMessage(db, ctx, a, msg(maria, ["nao-existe"]))).toThrow(/não existe/);
  });

  it("enviado: nota com os anexos e auditoria do documento", async () => {
    const { db, ctx, maria, a, doc } = await setup();
    const p = doc("Proposta", "a");
    cm.setContactMessage(db, ctx, a, msg(maria, [p]));
    const job = cm.dueContactMessages(db, ctx, at9).jobs[0]!;
    cm.recordContactMessage(db, ctx, job.id, { ok: true, text: job.text, files: [{ documentId: p, filename: "Proposta.pdf" }] });
    expect(listNotes(db, "activity", a)[0]!.body).toContain("📎 Anexos: Proposta.pdf");
    const ev = many<{ action: string; detail: string }>(db, "SELECT action, detail FROM document_event WHERE document_id = ? AND action = 'whatsapp'", p);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.detail).toContain("Maria José");
  });

  it("salvar sem informar anexos mantém os já escolhidos; trocar anexos reabre o pendente", async () => {
    const { db, ctx, maria, a, doc } = await setup();
    const p = doc("Proposta", "a");
    cm.setContactMessage(db, ctx, a, msg(maria, [p]));
    cm.setContactMessage(db, ctx, a, msg(maria));
    expect(cm.getContactMessage(db, a)!.attachments).toBe(JSON.stringify([p]));
    cm.setContactMessage(db, ctx, a, msg(maria, null));
    expect(cm.getContactMessage(db, a)!.attachments).toBeNull();
  });
});
