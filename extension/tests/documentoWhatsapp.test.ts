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
