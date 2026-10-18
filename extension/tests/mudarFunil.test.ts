import { describe, expect, it } from "vitest";
import { cardHistory } from "../src/db/cardHistory";
import { changeCardPipeline, createCard, getCardRow, matchingStageId } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
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

  it("não aceita funil de outro tipo, o mesmo funil nem etapa de outro funil", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Novo" }] });
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const outro = createPipeline(db, ctx, { name: "Outro", type: "comercial", stages: [{ name: "Novo" }] });
    const id = createCard(db, ctx, { pipelineId: vendas, title: "X" });
    expect(() => changeCardPipeline(db, ctx, id, { pipelineId: suporte })).toThrow(/mesmo tipo/);
    expect(() => changeCardPipeline(db, ctx, id, { pipelineId: vendas })).toThrow(/já está neste funil/);
    expect(() => changeCardPipeline(db, ctx, id, { pipelineId: outro, stageId: stagesOf(db, vendas)[0]!.id })).toThrow(/não pertence/);
  });
});
