import { describe, expect, it } from "vitest";
import { cardHistory } from "../src/db/cardHistory";
import { changeCardPipeline, createCard, getCardRow, matchingStageId } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createCustomField, getCustomValues, listCustomFields } from "../src/db/customFields";
import { createTag, getEntityTags } from "../src/db/tags";
import { cloneCard, getCard, listDealItems } from "../src/db/deals";
import { many } from "../src/db/sql";
import { freshDb } from "./helpers";

const stagesOf = (db: Awaited<ReturnType<typeof freshDb>>["db"], pipelineId: string) =>
  many<{ id: string; name: string }>(db, "SELECT id, name FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position", pipelineId);

describe("mudar o cartão de funil", () => {
  it("vai para a etapa de mesmo nome (sem acento/maiúsculas) e registra no histórico", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }, { name: "Reunião" }, { name: "Proposta" }] });
    const parcerias = createPipeline(db, ctx, { name: "Parcerias", type: "comercial", stages: [{ name: "Contato" }, { name: "REUNIAO" }] });
    const [, reuniao] = stagesOf(db, vendas);
    const id = createCard(db, ctx, { pipelineId: vendas, stageId: reuniao!.id, title: "FUNLEC" });
    const destino = stagesOf(db, parcerias)[1]!;
    expect(matchingStageId(db, reuniao!.id, parcerias)).toBe(destino.id);
    expect(changeCardPipeline(db, ctx, id, { pipelineId: parcerias })).toBe(destino.id);
    const card = getCardRow(db, id)!;
    expect([card.pipeline_id, card.stage_id]).toEqual([parcerias, destino.id]);
    const lines = cardHistory(db, id).flatMap((h) => h.lines);
    expect(lines).toContain("Mudou de funil: Vendas › Reunião → Parcerias › REUNIAO");
  });

  it("sem etapa correspondente pede a etapa; com ela escolhida, move", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Proposta" }] });
    const outro = createPipeline(db, ctx, { name: "Retomar", type: "comercial", stages: [{ name: "Novo" }, { name: "Retorno" }] });
    const id = createCard(db, ctx, { pipelineId: vendas, title: "Colégio" });
    expect(() => changeCardPipeline(db, ctx, id, { pipelineId: outro })).toThrow(/Escolha a etapa/);
    const retorno = stagesOf(db, outro)[1]!;
    changeCardPipeline(db, ctx, id, { pipelineId: outro, stageId: retorno.id });
    expect(getCardRow(db, id)!.stage_id).toBe(retorno.id);
  });

  it("não aceita o mesmo funil nem etapa de outro funil", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Novo" }] });
    const outro = createPipeline(db, ctx, { name: "Outro", type: "comercial", stages: [{ name: "Novo" }] });
    const id = createCard(db, ctx, { pipelineId: vendas, title: "X" });
    expect(() => changeCardPipeline(db, ctx, id, { pipelineId: vendas })).toThrow(/já está neste funil/);
    expect(() => changeCardPipeline(db, ctx, id, { pipelineId: outro, stageId: stagesOf(db, vendas)[0]!.id })).toThrow(/não pertence/);
  });
});

describe("mudar entre tipos e clonar", () => {
  const setup = async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Novo" }, { name: "Proposta" }] });
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Proposta" }, { name: "Resolvido" }] });
    const vip = createTag(db, ctx, { entity: "deal", name: "VIP", color: "amber" });
    const cfDeal = createCustomField(db, ctx, { entity: "deal", name: "Turma", fieldType: "text" });
    const lstDeal = createCustomField(db, ctx, { entity: "deal", name: "Plano", fieldType: "select", options: [{ label: "Ouro" }, { label: "Prata" }] });
    createCustomField(db, ctx, { entity: "ticket", name: "turma", fieldType: "text" });
    createCustomField(db, ctx, { entity: "ticket", name: "Plano", fieldType: "select", options: [{ label: "Prata" }, { label: "OURO" }] });
    const ouro = listCustomFields(db, "deal").find((f) => f.id === lstDeal)!.options.find((o) => o.label === "Ouro")!.id;
    const id = createCard(db, ctx, {
      pipelineId: vendas,
      stageId: stagesOf(db, vendas)[1]!.id,
      title: "FUNLEC",
      expectedCloseAt: "2026-12-01T00:00:00.000Z",
      items: [{ description: "Licença", quantity: 2, unitPriceCents: 10000 }],
      tagIds: [vip],
      customValues: { [cfDeal]: "3º ano", [lstDeal]: ouro },
    });
    return { db, ctx, vendas, suporte, id };
  };

  it("negócio vira ticket: etapa de mesmo nome, tags e campos de mesmo nome levados, previsão guardada", async () => {
    const { db, ctx, suporte, id } = await setup();
    changeCardPipeline(db, ctx, id, { pipelineId: suporte });
    const card = getCard(db, id)!;
    expect([card.kind, card.pipeline_id, card.stage_id]).toEqual(["ticket", suporte, stagesOf(db, suporte)[0]!.id]);
    expect(card.expected_close_at).toBe("2026-12-01T00:00:00.000Z"); // guardado, não aparece no ticket
    expect(getEntityTags(db, id).map((t) => [t.entity, t.name, t.color])).toEqual([["ticket", "VIP", "amber"]]);
    const fields = listCustomFields(db, "ticket");
    const values = getCustomValues(db, id);
    expect(values[fields.find((f) => f.name === "turma")!.id]).toBe("3º ano");
    const plano = fields.find((f) => f.name === "Plano")!;
    expect(values[plano.id]).toBe(plano.options.find((o) => o.label === "OURO")!.id);
    expect(cardHistory(db, id).flatMap((h) => h.lines)).toContain("Mudou de funil: Vendas › Proposta → Suporte › Proposta (agora ticket)");
  });

  it("clona no mesmo funil ou em outro tipo, sem mexer no original", async () => {
    const { db, ctx, vendas, suporte, id } = await setup();
    const copia = cloneCard(db, ctx, id, { pipelineId: vendas, title: "FUNLEC (cópia)" });
    const c = getCard(db, copia)!;
    expect([c.title, c.kind, c.stage_id, c.value_cents, c.expected_close_at]).toEqual(["FUNLEC (cópia)", "deal", getCard(db, id)!.stage_id, 20000, "2026-12-01T00:00:00.000Z"]);
    expect(listDealItems(db, copia).map((i) => i.description)).toEqual(["Licença"]);
    expect(getEntityTags(db, copia).map((t) => t.name)).toEqual(["VIP"]);

    const ticket = cloneCard(db, ctx, id, { pipelineId: suporte, stageId: stagesOf(db, suporte)[1]!.id });
    const t = getCard(db, ticket)!;
    expect([t.title, t.kind, t.pipeline_id, t.expected_close_at]).toEqual(["FUNLEC", "ticket", suporte, null]);
    expect(getEntityTags(db, ticket).map((x) => x.entity)).toEqual(["ticket"]);
    expect(getCard(db, id)!.kind).toBe("deal");
    expect(() => cloneCard(db, ctx, id, { pipelineId: createPipeline(db, ctx, { name: "P", type: "projeto", stages: [{ name: "Fase 1" }] }) })).toThrow(/Escolha a etapa/);
  });
});
