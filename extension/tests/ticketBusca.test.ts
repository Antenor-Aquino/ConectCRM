import { describe, expect, it } from "vitest";
import { createActivity } from "../src/db/activities";
import { cardCounts } from "../src/db/cardCounts";
import { createOrganization, createPerson } from "../src/db/contacts";
import { changeCardPipeline, cloneCard, createCard, getBoard, getCardRow, ticketNumberQuery } from "../src/db/deals";
import { globalSearch } from "../src/db/globalSearch";
import { addNote } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { freshDb } from "./helpers";

describe("número do ticket", () => {
  it("sequencial nos tickets; negócio não tem; ao virar ticket ganha o próximo; clone ganha novo", async () => {
    const { db, ctx } = await freshDb();
    const sup = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Novo" }] });
    const t1 = createCard(db, ctx, { pipelineId: sup, title: "Erro no login" });
    const t2 = createCard(db, ctx, { pipelineId: sup, title: "Impressora" });
    const d = createCard(db, ctx, { pipelineId: vendas, title: "Proposta" });
    expect([getCardRow(db, t1)!.ticket_number, getCardRow(db, t2)!.ticket_number, getCardRow(db, d)!.ticket_number]).toEqual([1, 2, null]);
    changeCardPipeline(db, ctx, d, { pipelineId: sup });
    expect(getCardRow(db, d)!.ticket_number).toBe(3);
    // Volta a ser negócio e depois ticket de novo: mantém o número.
    changeCardPipeline(db, ctx, d, { pipelineId: vendas });
    changeCardPipeline(db, ctx, d, { pipelineId: sup });
    expect(getCardRow(db, d)!.ticket_number).toBe(3);
    expect(getCardRow(db, cloneCard(db, ctx, t1, { pipelineId: sup }))!.ticket_number).toBe(4);
  });

  it("pesquisa no funil pelo número (234, #234, Ticket: 234)", async () => {
    const { db, ctx } = await freshDb();
    const sup = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    createCard(db, ctx, { pipelineId: sup, title: "Erro no login" });
    createCard(db, ctx, { pipelineId: sup, title: "Impressora" });
    expect([ticketNumberQuery("2"), ticketNumberQuery("#2"), ticketNumberQuery("Ticket: 2"), ticketNumberQuery("ticket 2"), ticketNumberQuery("erro")]).toEqual([2, 2, 2, 2, null]);
    const found = (search: string) => getBoard(db, sup, { search }).flatMap((c) => c.cards.map((k) => k.title));
    expect(found("Ticket: 2")).toEqual(["Impressora"]);
    expect(found("#1")).toEqual(["Erro no login"]);
  });
});

describe("contagens das abas do cartão", () => {
  it("histórico, notas, atividades (e atrasadas) e documentos", async () => {
    const { db, ctx } = await freshDb();
    const p = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Novo" }] });
    const id = createCard(db, ctx, { pipelineId: p, title: "FUNLEC" });
    addNote(db, ctx, "deal", id, "<p>Ligar amanhã</p>");
    createActivity(db, ctx, { title: "Atrasada", dealId: id, dueAt: "2020-01-01T10:00:00.000Z" });
    createActivity(db, ctx, { title: "Futura", dealId: id, dueAt: "2099-01-01T10:00:00.000Z" });
    createActivity(db, ctx, { title: "Feita", dealId: id, dueAt: "2020-01-01T10:00:00.000Z", done: true });
    const c = cardCounts(db, id);
    expect({ ...c, history: c.history > 0 }).toEqual({ history: true, notes: 1, activities: 3, activitiesOverdue: 1, documents: 0 });
  });
});

describe("pesquisa geral", () => {
  it("encontra cartão pelo número do ticket, contato, organização, atividade e nota", async () => {
    const { db, ctx } = await freshDb();
    const sup = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const org = createOrganization(db, ctx, { name: "Genialsoft" });
    const person = createPerson(db, ctx, { name: "Renato Ayres", email: "renato@genialsoft.com.br", organizationIds: [org] });
    const t = createCard(db, ctx, { pipelineId: sup, title: "Erro no boleto", personId: person });
    createActivity(db, ctx, { title: "Ligar para Genialsoft", dealId: t });
    addNote(db, ctx, "person", person, "<p>Prefere contato pelo <b>WhatsApp</b> à tarde</p>");
    const byTicket = globalSearch(db, "Ticket: 1", null);
    expect(byTicket.cards.map((c) => [c.title, c.ticket_number, c.pipeline_name])).toEqual([["Erro no boleto", 1, "Suporte"]]);
    const r = globalSearch(db, "genialsoft", null);
    expect(r.persons.map((p) => p.name)).toEqual(["Renato Ayres"]);
    expect(r.organizations.map((o) => o.name)).toEqual(["Genialsoft"]);
    expect(r.activities.map((a) => a.title)).toEqual(["Ligar para Genialsoft"]);
    expect(globalSearch(db, "whatsapp", null).notes.map((n) => [n.entity_name, n.text])).toEqual([["Renato Ayres", "Prefere contato pelo WhatsApp à tarde"]]);
    expect(globalSearch(db, "a", null).cards).toEqual([]);
  });
});

describe("cartões escondidos pelo filtro", () => {
  it("conta os que o filtro de tag/responsável esconde (mesma situação e pesquisa)", async () => {
    const { db, ctx } = await freshDb();
    const { createTag } = await import("../src/db/tags");
    const { createUser } = await import("../src/db/users");
    const { boardHiddenByFilter } = await import("../src/db/deals");
    const p = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
    const teste = createTag(db, ctx, { entity: "deal", name: "Teste" });
    const antenor = createUser(db, ctx, { name: "Antenor", role: "admin" });
    createCard(db, ctx, { pipelineId: p, title: "Abrir ticket ISAAC", ownerId: antenor, tagIds: [teste] });
    createCard(db, ctx, { pipelineId: p, title: "Proposta teste", ownerId: antenor });
    expect(boardHiddenByFilter(db, p, { ownerIds: [antenor], tagIds: [teste] })).toBe(1);
    expect(boardHiddenByFilter(db, p, { ownerIds: [antenor], tagIds: [teste], search: "ISAAC" })).toBe(0);
    expect(boardHiddenByFilter(db, p, {})).toBe(0);
  });
});
