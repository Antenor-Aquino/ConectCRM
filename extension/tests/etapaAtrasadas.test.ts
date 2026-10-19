import { describe, expect, it } from "vitest";
import { createActivity } from "../src/db/activities";
import { createCard, getBoard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { many } from "../src/db/sql";
import { freshDb } from "./helpers";

describe("cabeçalho da etapa", () => {
  it("soma as atividades atrasadas dos cartões da etapa (concluídas e futuras não contam)", async () => {
    const { db, ctx } = await freshDb();
    const p = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Contato" }, { name: "Contrato" }] });
    const [contato, contrato] = many<{ id: string }>(db, "SELECT id FROM stage WHERE pipeline_id = ? ORDER BY position", p);
    const a = createCard(db, ctx, { pipelineId: p, stageId: contrato!.id, title: "Norma" });
    const b = createCard(db, ctx, { pipelineId: p, stageId: contrato!.id, title: "Teófilo" });
    createCard(db, ctx, { pipelineId: p, stageId: contato!.id, title: "Sem atividades" });
    const ontem = new Date(Date.now() - 2 * 86400000).toISOString();
    const amanha = new Date(Date.now() + 2 * 86400000).toISOString();
    createActivity(db, ctx, { title: "Ligar", dueAt: ontem, dealId: a });
    createActivity(db, ctx, { title: "Enviar contrato", dueAt: ontem, dealId: a });
    createActivity(db, ctx, { title: "Reunião", dueAt: ontem, dealId: b });
    createActivity(db, ctx, { title: "Feita", dueAt: ontem, dealId: b, done: true });
    createActivity(db, ctx, { title: "Futura", dueAt: amanha, dealId: b });
    const cols = getBoard(db, p);
    expect(cols.map((c) => [c.name, c.count, c.overdue_activities])).toEqual([
      ["Contato", 1, 0],
      ["Contrato", 2, 3],
    ]);
  });
});
