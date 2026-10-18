import { describe, expect, it } from "vitest";
import { listActivities } from "../src/db/activities";
import { bulkCards, setCardArchived } from "../src/db/bulkCards";
import { addCardContact, listCardContacts, removeCardContact, setPrimaryCardContact } from "../src/db/cardContacts";
import { cardHistory } from "../src/db/cardHistory";
import { createPerson } from "../src/db/contacts";
import { createCustomField, getCustomValues } from "../src/db/customFields";
import { cloneCard, createCard, getBoard, getCard, getCardRow, listCardsForEntity, updateCard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { many, one } from "../src/db/sql";
import { createTag, getEntityTags } from "../src/db/tags";
import { createUser, getViewer } from "../src/db/users";
import { freshDb } from "./helpers";

type Db = Awaited<ReturnType<typeof freshDb>>["db"];
const stagesOf = (db: Db, pipelineId: string) =>
  many<{ id: string; name: string }>(db, "SELECT id, name FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position", pipelineId);

describe("vários contatos no cartão", () => {
  it("principal e outros contatos: adicionar, trocar principal, remover, busca, ficha do contato, clonar e histórico", async () => {
    const { db, ctx } = await freshDb();
    const p = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }] });
    const ana = createPerson(db, ctx, { name: "Ana" });
    const bruno = createPerson(db, ctx, { name: "Bruno Decisor" });
    const carla = createPerson(db, ctx, { name: "Carla" });
    const id = createCard(db, ctx, { pipelineId: p, title: "Escola X", personId: ana });
    addCardContact(db, ctx, id, bruno);
    addCardContact(db, ctx, id, carla);
    addCardContact(db, ctx, id, bruno); // repetido não duplica
    expect(listCardContacts(db, id).map((c) => [c.name, c.is_primary])).toEqual([
      ["Ana", 1],
      ["Bruno Decisor", 0],
      ["Carla", 0],
    ]);
    expect(getBoard(db, p)[0]!.cards[0]!.extra_contacts).toBe(2);
    expect(getBoard(db, p, { search: "decisor" })[0]!.cards.map((c) => c.title)).toEqual(["Escola X"]);
    expect(listCardsForEntity(db, { personId: carla }).map((c) => c.title)).toEqual(["Escola X"]);
    setPrimaryCardContact(db, ctx, id, bruno);
    expect(listCardContacts(db, id).map((c) => c.name)).toEqual(["Bruno Decisor", "Carla", "Ana"]);
    // Trocar o principal pelo campo "Contato" tira ele de "outros".
    updateCard(db, ctx, id, { personId: carla });
    expect(listCardContacts(db, id).map((c) => c.name)).toEqual(["Carla", "Ana"]);
    const copy = cloneCard(db, ctx, id, { pipelineId: p });
    expect(listCardContacts(db, copy).map((c) => c.name)).toEqual(["Carla", "Ana"]);
    removeCardContact(db, ctx, id, carla); // sai o principal: o próximo assume
    expect(listCardContacts(db, id).map((c) => [c.name, c.is_primary])).toEqual([["Ana", 1]]);
    expect(getCard(db, id)!.contacts.map((c) => c.name)).toEqual(["Ana"]);
    const lines = cardHistory(db, id).flatMap((h) => h.lines);
    expect(lines).toEqual(expect.arrayContaining(["Adicionou o contato Bruno Decisor", "Adicionou o contato Carla", "Removeu o contato Ana"]));
  });
});

describe("ações em lote", () => {
  it("mover etapa, mudar de funil (de outra categoria), responsável, tags, situação, campos, contato e atividade", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
    const v = getViewer(db, admin);
    const actx = { ...ctx, userId: admin };
    const vendas = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }, { name: "Proposta" }] });
    const suporte = createPipeline(db, actx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }, { name: "Proposta" }] });
    const [prospect, proposta] = stagesOf(db, vendas);
    const a = createCard(db, actx, { pipelineId: vendas, title: "A" });
    const b = createCard(db, actx, { pipelineId: vendas, title: "B" });
    expect(bulkCards(db, actx, v, [a, b], { type: "moveStage", stageId: proposta!.id })).toEqual({ done: 2, errors: [] });
    expect([getCardRow(db, a)!.stage_id, getCardRow(db, b)!.stage_id]).toEqual([proposta!.id, proposta!.id]);
    const vip = createTag(db, actx, { entity: "deal", name: "VIP" });
    bulkCards(db, actx, v, [a, b], { type: "addTags", tagIds: [vip] });
    expect(getEntityTags(db, a).map((t) => t.name)).toEqual(["VIP"]);
    bulkCards(db, actx, v, [b], { type: "removeTags", tagIds: [vip] });
    expect(getEntityTags(db, b)).toEqual([]);
    const carla = createUser(db, actx, { name: "Carla", role: "vendedor" });
    bulkCards(db, actx, v, [a, b], { type: "owner", ownerId: carla });
    expect(getCardRow(db, a)!.owner_id).toBe(carla);
    bulkCards(db, actx, v, [a], { type: "setField", field: "expectedCloseAt", value: "2026-12-15T12:00:00.000Z" });
    expect(getCardRow(db, a)!.expected_close_at).toBe("2026-12-15T12:00:00.000Z");
    const fid = createCustomField(db, actx, { entity: "deal", name: "Produto", fieldType: "text" });
    bulkCards(db, actx, v, [a, b], { type: "setCustom", fieldId: fid, value: "ERP" });
    expect(getCustomValues(db, b)[fid]).toBe("ERP");
    const ana = createPerson(db, actx, { name: "Ana" });
    bulkCards(db, actx, v, [a], { type: "addContact", personId: ana });
    expect(getCardRow(db, a)!.person_id).toBe(ana);
    const r = bulkCards(db, actx, v, [a, b], { type: "activity", title: "Retomar contato", dueAt: "2026-11-01T12:00:00.000Z", ownerFromCard: true });
    expect(r.done).toBe(2);
    expect(listActivities(db, { dealId: a }).map((x) => [x.title, x.owner_id])).toEqual([["Retomar contato", carla]]);
    bulkCards(db, actx, v, [b], { type: "status", status: "won" });
    expect(getCardRow(db, b)!.status).toBe("won");
    // Outra categoria: etapa de mesmo nome ("Proposta"), o cartão vira ticket.
    const novo = stagesOf(db, suporte)[0]!.id;
    expect(bulkCards(db, actx, v, [a], { type: "changePipeline", pipelineId: suporte, fallbackStageId: novo })).toEqual({ done: 1, errors: [] });
    expect([getCardRow(db, a)!.pipeline_id, getCardRow(db, a)!.kind, getCardRow(db, a)!.stage_id]).toEqual([suporte, "ticket", stagesOf(db, suporte)[1]!.id]);
    // Campo que não existe no tipo: erro só daquele cartão.
    const c = createCard(db, actx, { pipelineId: vendas, stageId: prospect!.id, title: "C" });
    const res = bulkCards(db, actx, v, [a, c], { type: "setField", field: "expectedCloseAt", value: "2026-12-01T12:00:00.000Z" });
    expect(res.done).toBe(1);
    expect(res.errors).toEqual([{ id: a, title: "A", message: "Este campo não existe neste tipo de cartão." }]);
  });

  it("arquivar tira do quadro (filtro Arquivados mostra), desarquivar volta; excluir; vendedor não mexe no que não vê", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
    const vend = createUser(db, ctx, { name: "Vera", role: "vendedor" });
    const actx = { ...ctx, userId: admin };
    const p = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }] });
    const a = createCard(db, actx, { pipelineId: p, title: "A" });
    const b = createCard(db, actx, { pipelineId: p, title: "B", ownerId: vend });
    bulkCards(db, actx, getViewer(db, admin), [a], { type: "archive" });
    expect(getBoard(db, p)[0]!.cards.map((c) => c.title)).toEqual(["B"]);
    expect(getBoard(db, p, { status: "archived" })[0]!.cards.map((c) => c.title)).toEqual(["A"]);
    expect(getBoard(db, p, { status: "all" })[0]!.cards.map((c) => [c.title, !!c.archived_at]).sort()).toEqual([
      ["A", true],
      ["B", false],
    ]);
    expect(cardHistory(db, a).flatMap((h) => h.lines)).toContain("Arquivou o cartão");
    setCardArchived(db, actx, a, false);
    expect(getBoard(db, p)[0]!.cards).toHaveLength(2);
    const r = bulkCards(db, { ...ctx, userId: vend }, getViewer(db, vend), [a, b], { type: "delete" });
    expect(r.done).toBe(1);
    expect(r.errors[0]).toMatchObject({ id: a, message: expect.stringMatching(/permissão/) });
    expect(one(db, "SELECT deleted_at FROM deal WHERE id = ?", b)).toMatchObject({ deleted_at: expect.any(String) });
  });
});
