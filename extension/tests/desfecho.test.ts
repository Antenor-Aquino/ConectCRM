import { describe, expect, it } from "vitest";
import { cardHistory } from "../src/db/cardHistory";
import { cardDigest, salesSummary } from "../src/db/copilot";
import { createCard, createLossReason, setCardStatus } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { buildReport } from "../src/db/reports";
import { OUTCOME_TEXT, outcomeLabel } from "../src/lib/cardTypes";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

describe("desfecho do cartão por tipo de funil", () => {
  it("termos: ganho/perdido, resolvido/não resolvido, concluído/não concluído", () => {
    expect([outcomeLabel("comercial", "won"), outcomeLabel("comercial", "lost")]).toEqual(["Ganho", "Perdido"]);
    expect([outcomeLabel("operacional", "won"), outcomeLabel("operacional", "lost")]).toEqual(["Resolvido", "Não resolvido"]);
    expect([outcomeLabel("projeto", "won"), outcomeLabel("projeto", "lost")]).toEqual(["Concluído", "Não concluído"]);
    expect(outcomeLabel("projeto", "open")).toBeNull();
  });

  async function setup() {
    const { db, ctx } = await freshDb();
    const sup = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }, { name: "Em atendimento" }] });
    const proj = createPipeline(db, ctx, { name: "Implantação", type: "projeto", stages: [{ name: "A fazer" }] });
    const reason = createLossReason(db, ctx, "Cliente desistiu");
    const t1 = createCard(db, ctx, { pipelineId: sup, title: "Falha no acesso" });
    const t2 = createCard(db, ctx, { pipelineId: sup, title: "Erro no boleto" });
    const p1 = createCard(db, ctx, { pipelineId: proj, title: "Treinamento" });
    db.run("UPDATE change_log SET at = strftime('%Y-%m-%dT%H:%M:%fZ', at, '-1 minute')");
    setCardStatus(db, ctx, t1, { status: "won" });
    setCardStatus(db, ctx, t2, { status: "lost", lossReasonId: reason, lossNote: "Sem retorno" });
    setCardStatus(db, ctx, p1, { status: "lost" });
    return { db, ctx, sup, proj, t1, t2, p1 };
  }

  it("histórico usa os termos do tipo do funil", async () => {
    const { db, t1, t2, p1 } = await setup();
    const lines = (id: string) => cardHistory(db, id).flatMap((e) => e.lines);
    expect(lines(t1)).toContain("Marcou como resolvido");
    expect(lines(t2)).toEqual(expect.arrayContaining(["Marcou como não resolvido", "Motivo (não resolvido): vazio → Cliente desistiu"]));
    expect(lines(p1)).toContain("Marcou como não concluído");
  });

  it("detalhe traz o nome do motivo; copiloto descreve com os termos do tipo", async () => {
    const { db, ctx, t1, t2 } = await setup();
    expect(methods["cards.get"](db, ctx, { id: t2 })).toMatchObject({ status: "lost", loss_reason_name: "Cliente desistiu" });
    expect(cardDigest(db, null, t1)).toMatchObject({ status: "resolvido" });
    expect(cardDigest(db, null, t2)).toMatchObject({ status: "não resolvido" });
  });

  it("relatório de funil operacional: tipo, termos na conversão e no copiloto", async () => {
    const { db, sup } = await setup();
    const from = new Date(Date.now() - 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    const r = buildReport(db, { from, to, pipelineId: sup });
    expect(r.pipelineType).toBe("operacional");
    expect(r.summary.won.count).toBe(1);
    expect(r.summary.lost.count).toBe(1);
    expect(r.funnel!.at(-1)).toMatchObject({ name: "Resolvido", reached: 1 });
    expect(buildReport(db, { from, to }).pipelineType).toBe("comercial");
    const day = (d: string) => d.slice(0, 10);
    const s = salesSummary(db, null, { de: day(from), ate: day(to), funil: "Suporte" }) as { termos: unknown };
    expect(s.termos).toEqual({ ganhos: "Resolvidos", perdidos: "Não resolvidos", taxaDeConversao: OUTCOME_TEXT.operacional.rate });
  });
});
