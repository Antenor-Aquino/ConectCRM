import { describe, expect, it } from "vitest";
import { createActivity, setActivityDone } from "../src/db/activities";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createLossReason, createCard, getBoard, getCard, getCardRow, moveCard, setCardStatus, setDealItems, updateCard } from "../src/db/deals";
import { createPipeline, listStages } from "../src/db/pipelines";
import { createProduct } from "../src/db/products";
import { createTeam, createUser } from "../src/db/users";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx } = await freshDb();
  const me = createUser(db, ctx, { name: "Antenor", role: "admin" });
  const c = { ...ctx, userId: me };
  const pipelineId = createPipeline(db, c, {
    name: "PowerCubus",
    type: "comercial",
    stages: [{ name: "Prospect" }, { name: "Contato" }, { name: "Reunião" }],
  });
  const [s1, s2, s3] = listStages(db, pipelineId);
  return { db, ctx: c, me, pipelineId, s1: s1!.id, s2: s2!.id, s3: s3!.id };
}

describe("cartões do Kanban", () => {
  it("negócio nasce na primeira etapa, com responsável atual e organização principal do contato", async () => {
    const { db, ctx, me, pipelineId, s1 } = await setup();
    const person = createPerson(db, ctx, { name: "Dalliane" });
    const org = createOrganization(db, ctx, { name: "ABMES", personIds: [person] });
    const id = createCard(db, ctx, { pipelineId, title: "Dalliane ABMES", valueCents: 150000, personId: person });
    expect(getCard(db, id)).toMatchObject({
      kind: "deal",
      stage_id: s1,
      owner_id: me,
      organization_id: org,
      organization_name: "ABMES",
      person_name: "Dalliane",
      value_cents: 150000,
      status: "open",
    });
    expect(getCard(db, id)!.stageHistory.map((h) => h.stage_name)).toEqual(["Prospect"]);
  });

  it("campos de cada tipo de funil", async () => {
    const { db, ctx } = await setup();
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo ticket" }] });
    const projeto = createPipeline(db, ctx, { name: "Implantação", type: "projeto", stages: [{ name: "A fazer" }] });
    // Valor e produtos/serviços valem para todos os tipos de funil.
    const comValor = createCard(db, ctx, { pipelineId: suporte, title: "Falha", valueCents: 100 });
    setDealItems(db, ctx, comValor, [{ description: "Visita técnica", quantity: 2, unitPriceCents: 15000 }]);
    expect(getCardRow(db, comValor)).toMatchObject({ value_cents: 30000, value_from_items: 1 });
    expect(() => createCard(db, ctx, { pipelineId: suporte, title: " " })).toThrow(/título do ticket/);
    const ticket = createCard(db, ctx, { pipelineId: suporte, title: "Falha no acesso", slaAt: "2026-10-20T18:00:00-03:00" });
    expect(getCard(db, ticket)).toMatchObject({ kind: "ticket", sla_at: "2026-10-20T21:00:00.000Z" });
    expect(() => createCard(db, ctx, { pipelineId: projeto, title: "Kickoff", slaAt: "2026-10-20" })).toThrow(/SLA não se aplica/);
    const etapa = createCard(db, ctx, { pipelineId: projeto, title: "Kickoff", dueAt: "2026-11-01T12:00:00Z" });
    expect(getCard(db, etapa)!.kind).toBe("project");
  });

  it("move entre etapas registrando histórico e reordena na coluna", async () => {
    const { db, ctx, pipelineId, s1, s2 } = await setup();
    const a = createCard(db, ctx, { pipelineId, title: "A" });
    const b = createCard(db, ctx, { pipelineId, title: "B" });
    const c = createCard(db, ctx, { pipelineId, title: "C" });
    moveCard(db, ctx, a, { stageId: s2 });
    moveCard(db, ctx, b, { stageId: s2 });
    moveCard(db, ctx, c, { stageId: s2, beforeId: b });
    const col = getBoard(db, pipelineId, { sort: "manual" }).find((s) => s.id === s2)!;
    expect(col.cards.map((x) => x.title)).toEqual(["A", "C", "B"]);
    const hist = getCard(db, a)!.stageHistory;
    expect(hist.map((h) => [h.stage_name, h.left_at === null])).toEqual([["Prospect", false], ["Contato", true]]);
    moveCard(db, ctx, a, { stageId: s2, beforeId: c });
    expect(getCard(db, a)!.stageHistory).toHaveLength(2);
    expect(getBoard(db, pipelineId).find((s) => s.id === s1)!.count).toBe(0);
  });

  it("não move para funil de outro tipo", async () => {
    const { db, ctx, pipelineId } = await setup();
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const deal = createCard(db, ctx, { pipelineId, title: "X" });
    expect(() => moveCard(db, ctx, deal, { stageId: listStages(db, suporte)[0]!.id })).toThrow(/mesmo tipo/);
  });

  it("produtos: valor vira soma dos itens; valor manual desvincula", async () => {
    const { db, ctx, pipelineId } = await setup();
    const licenca = createProduct(db, ctx, { name: "Licença", kind: "servico", priceCents: 10000, recurrence: "mensal" });
    const id = createCard(db, ctx, { pipelineId, title: "Proposta 2026" });
    setDealItems(db, ctx, id, [{ productId: licenca, quantity: 3, discountCents: 5000 }, { description: "Implantação", unitPriceCents: 20000 }]);
    const card = getCard(db, id)!;
    expect(card.value_cents).toBe(45000);
    expect(card.value_from_items).toBe(1);
    expect(card.items.map((i) => [i.description, i.total_cents, i.recurrence])).toEqual([["Licença", 25000, "mensal"], ["Implantação", 20000, "avulso"]]);
    setDealItems(db, ctx, id, [{ id: card.items[1]!.id, description: "Implantação", unitPriceCents: 30000 }]);
    expect(getCard(db, id)!.value_cents).toBe(30000);
    updateCard(db, ctx, id, { valueCents: 99900 });
    expect(getCard(db, id)).toMatchObject({ value_cents: 99900, value_from_items: 0 });
  });

  it("ganho, perdido com motivo e reabrir", async () => {
    const { db, ctx, pipelineId } = await setup();
    const reason = createLossReason(db, ctx, "Preço");
    const id = createCard(db, ctx, { pipelineId, title: "Regina" });
    setCardStatus(db, ctx, id, { status: "lost", lossReasonId: reason, lossNote: "Achou caro" });
    expect(getCard(db, id)).toMatchObject({ status: "lost", loss_reason_id: reason, loss_note: "Achou caro" });
    expect(getBoard(db, pipelineId).every((s) => s.count === 0)).toBe(true);
    expect(getBoard(db, pipelineId, { status: "lost" })[0]!.count).toBe(1);
    setCardStatus(db, ctx, id, { status: "open" });
    expect(getCard(db, id)).toMatchObject({ status: "open", loss_reason_id: null, closed_at: null });
  });

  it("quadro: soma por etapa, tarefas concluídas/total e visões Geral/Meu/Equipe", async () => {
    const { db, ctx, me, pipelineId, s1 } = await setup();
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
    createTeam(db, ctx, { name: "Time", members: [{ userId: me }, { userId: ana }] });
    const mine = createCard(db, ctx, { pipelineId, title: "Meu", valueCents: 1000 });
    createCard(db, ctx, { pipelineId, title: "Da Ana", valueCents: 2000, ownerId: ana });
    createCard(db, ctx, { pipelineId, title: "Da Bia", valueCents: 4000, ownerId: bia });
    const t = createActivity(db, ctx, { title: "Ligar", dealId: mine });
    createActivity(db, ctx, { title: "Enviar proposta", dealId: mine });
    setActivityDone(db, ctx, t, true);

    const all = getBoard(db, pipelineId).find((s) => s.id === s1)!;
    expect([all.count, all.total_cents]).toEqual([3, 7000]);
    expect(all.cards.map((c) => c.title)).toEqual(["Da Bia", "Da Ana", "Meu"]);
    expect(all.cards.find((c) => c.title === "Meu")).toMatchObject({ tasks_total: 2, tasks_done: 1, owner_name: "Antenor" });

    const viewer = { id: me, role: "admin" as const };
    const titles = (view: "mine" | "team") => getBoard(db, pipelineId, { view, viewer })[0]!.cards.map((c) => c.title).sort();
    expect(titles("mine")).toEqual(["Meu"]);
    expect(titles("team")).toEqual(["Da Ana", "Meu"]);
    expect(getBoard(db, pipelineId, { search: "bia" })[0]!.count).toBe(1);
  });
});
