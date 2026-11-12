// Mesclar negócios, contatos e organizações (spec 17): tudo o que estava ligado
// ao que sai vem para o que fica; escolha campo a campo; Gestão Financeira.
import { describe, expect, it } from "vitest";
import { createActivity, listActivities } from "../src/db/activities";
import { createOrganization, createPerson, getOrganization, getPerson } from "../src/db/contacts";
import { createCustomField } from "../src/db/customFields";
import { createCard, getCard, listDealItems } from "../src/db/deals";
import * as docs from "../src/db/documents";
import { defaultChoices, mergePreview, mergeRecords } from "../src/db/mergeRecords";
import { addNote, listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { run } from "../src/db/sql";
import { createTag } from "../src/db/tags";
import * as todo from "../src/db/todo";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

let n = 0;
const file = (filename: string): docs.FileRef => ({ sha256: (++n).toString(16).padStart(64, "0"), mime: "application/pdf", size: 10, filename, location: "browser" });

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pid = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }, { name: "Contrato" }] });
  const type = docs.listDocumentTypes(db)[0]!.id;
  return { db, ctx, me, pid, type };
}

describe("mesclar negócios", () => {
  it("o que sai leva atividades, notas, documentos, produtos, contatos, etiquetas, To Do e campos; valor pela soma dos produtos", async () => {
    const { db, ctx, pid, type } = await setup();
    const cicero = createPerson(db, ctx, { name: "Cícero" });
    const talita = createPerson(db, ctx, { name: "Talita" });
    const tag = createTag(db, ctx, { entity: "deal", name: "Escola" });
    const campo = createCustomField(db, ctx, { entity: "deal", name: "Nº alunos", fieldType: "text" });
    const keep = createCard(db, ctx, { pipelineId: pid, title: "EE Professor Cicero Torres Galindo", personId: cicero, items: [{ description: "Certificado A1", unitPriceCents: 59900 }], customValues: { [campo]: "300" } });
    const dup = createCard(db, ctx, { pipelineId: pid, title: "EE PROFESSOR CICERO TORRES GALINDO", personId: talita, tagIds: [tag], description: "Duplicado do e-mail", items: [{ description: "Instalação", unitPriceCents: 10000 }], customValues: { [campo]: "320" } });
    createActivity(db, ctx, { title: "Ligar", dealId: dup });
    addNote(db, ctx, "deal", dup, "Nota do duplicado");
    const d = docs.createDocument(db, ctx, { name: "Proposta", typeId: type, links: [{ type: "deal", id: dup }], file: file("p.pdf") });
    const t = todo.createTodoTask(db, ctx, { title: "Cobrar", dealId: dup });

    const p = mergePreview(db, "deal", keep, dup);
    expect(p.suggestedKeep).toBe(keep); // o mais antigo
    expect(p.groups.find((g) => g.key === "person")).toMatchObject({ a: "Cícero", b: "Talita" });
    expect(p.custom).toEqual([{ fieldId: campo, label: "Nº alunos", a: "300", b: "320" }]);
    expect(p.b.related.map((r) => r.label)).toEqual(expect.arrayContaining(["Atividades", "Notas", "Documentos", "Produtos", "Tarefas do To Do", "Etiquetas"]));

    mergeRecords(db, ctx, { entity: "deal", keepId: keep, removeId: dup, takeFromRemoved: ["description", campo] });
    const c = getCard(db, keep)!;
    expect(c.description).toBe("Duplicado do e-mail");
    expect(c.customValues[campo]).toBe("320");
    expect(c.tags.map((x) => x.name)).toEqual(["Escola"]);
    expect(listDealItems(db, keep).map((i) => i.description)).toEqual(["Certificado A1", "Instalação"]);
    expect(c.value_cents).toBe(69900);
    // Contato principal do que saiu vira "outro contato".
    expect(c.contacts.map((x) => x.name).sort()).toEqual(["Cícero", "Talita"]);
    expect(listActivities(db, { dealId: keep }).map((a) => a.title)).toEqual(["Ligar"]);
    expect(listNotes(db, "deal", keep).map((x) => x.body)).toEqual(expect.arrayContaining(["Nota do duplicado", expect.stringContaining("Mesclado com")]));
    expect(docs.documentsFor(db, "deal", keep).map((x) => x.id)).toEqual([d]);
    expect(todo.getTodoTask(db, ctx, t)!.deal_id).toBe(keep);
    expect(getCard(db, dup)).toBeUndefined();
  });

  it("Gestão Financeira: o cartão com lançamentos fica; os dois com lançamentos não mesclam; só mesmo tipo", async () => {
    const { db, ctx, pid } = await setup();
    const a = createCard(db, ctx, { pipelineId: pid, title: "Com financeiro" });
    const b = createCard(db, ctx, { pipelineId: pid, title: "Sem financeiro" });
    const fin = (deal: string) =>
      run(db, "INSERT INTO finance_entry (id, workspace_id, deal_id, type, status, description, amount_cents, competence_date) VALUES (?, (SELECT id FROM workspace LIMIT 1), ?, 'income', 'paid', 'x', 100, '2026-11-01')", `f-${deal}`, deal);
    fin(a);
    expect(mergePreview(db, "deal", b, a).suggestedKeep).toBe(a);
    expect(() => mergeRecords(db, ctx, { entity: "deal", keepId: b, removeId: a })).toThrow(/precisa ser o que fica/);
    fin(b);
    expect(mergePreview(db, "deal", a, b).blocked).toMatch(/Os dois/);
    expect(() => mergeRecords(db, ctx, { entity: "deal", keepId: a, removeId: b })).toThrow(/Os dois/);
    const tickets = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const tk = createCard(db, ctx, { pipelineId: tickets, title: "Ticket" });
    expect(() => mergePreview(db, "deal", a, tk)).toThrow(/mesmo tipo/);
  });
});

describe("mesclar contatos e organizações", () => {
  it("contato: cartões, organizações, documentos, To Do e escolha de campos (CPF único)", async () => {
    const { db, ctx, pid, type } = await setup();
    const org = createOrganization(db, ctx, { name: "PowerCubus" });
    const keep = createPerson(db, ctx, { name: "Rozilene", email: "rozi@a.com" });
    const dup = createPerson(db, ctx, { name: "Rozi", phone: "35 93300-4989", cpf: "52998224725", organizationIds: [org] });
    const deal = createCard(db, ctx, { pipelineId: pid, title: "Contrato", personId: dup });
    const d = docs.createDocument(db, ctx, { name: "RG", typeId: type, links: [{ type: "person", id: dup }], file: file("rg.pdf") });
    const t = todo.createTodoTask(db, ctx, { title: "Ligar", personId: dup });
    const ch = defaultChoices(db, "person", keep, dup);
    expect(ch.takeFromRemoved.sort()).toEqual(["cpf", "phone"]);
    mergeRecords(db, ctx, { entity: "person", keepId: keep, removeId: dup, takeFromRemoved: [...ch.takeFromRemoved, "name"] });
    const p = getPerson(db, keep)!;
    expect(p).toMatchObject({ name: "Rozi", email: "rozi@a.com", cpf: "52998224725" });
    expect(p.organizations.map((o) => o.name)).toEqual(["PowerCubus"]);
    expect(getCard(db, deal)!.person_id).toBe(keep);
    expect(docs.documentsFor(db, "person", keep).map((x) => x.id)).toEqual([d]);
    expect(todo.getTodoTask(db, ctx, t)!.person_id).toBe(keep);
    expect(getPerson(db, dup)).toBeUndefined();
  });

  it("organização: contatos, cartões, descrição dos dois juntos; contato na Gestão Financeira fica", async () => {
    const { db, ctx, pid } = await setup();
    const keep = createOrganization(db, ctx, { name: "Escola Americana", description: "Cliente desde 2020" });
    const dup = createOrganization(db, ctx, { name: "Escola Americana de Vitória", cnpj: "11222333000181", description: "Matriz em Vitória" });
    const gean = createPerson(db, ctx, { name: "Gean", organizationIds: [dup] });
    const deal = createCard(db, ctx, { pipelineId: pid, title: "Renovação", organizationId: dup });
    run(db, "INSERT INTO finance_contact (crm_ref, workspace_id, pending, linked_at) VALUES (?, (SELECT id FROM workspace LIMIT 1), 0, '2026-11-01')", `organization:${dup}`);
    expect(mergePreview(db, "organization", keep, dup).suggestedKeep).toBe(dup);
    mergeRecords(db, ctx, { entity: "organization", keepId: dup, removeId: keep, takeFromRemoved: ["name"], joinBoth: ["description"] });
    const o = getOrganization(db, dup)!;
    expect(o).toMatchObject({ name: "Escola Americana", cnpj: "11222333000181", description: "Matriz em Vitória\n\nCliente desde 2020" });
    expect(getPerson(db, gean)!.organizations.map((x) => x.id)).toEqual([dup]);
    expect(getCard(db, deal)!.organization_id).toBe(dup);
    // Mudou o cadastro: a Gestão Financeira recebe a ficha nova.
    expect(methods["finance.pendingContacts"](db).length).toBeGreaterThan(0);
  });
});
