import { describe, expect, it } from "vitest";
import { activePipelineTypes, createPipeline, deletePipeline, listPipelines, listStages, updatePipeline } from "../src/db/pipelines";
import { insertRow } from "../src/db/repo";
import { visibleQuickCreateOptions } from "../src/lib/quickCreate";
import { freshDb } from "./helpers";

describe("funis", () => {
  it("cria funil com etapas em ordem", async () => {
    const { db, ctx } = await freshDb();
    const id = createPipeline(db, ctx, {
      name: " PowerCubus ",
      type: "comercial",
      stages: [{ name: "Prospect", color: "red" }, { name: "Contato" }, { name: "Reunião" }],
    });
    expect(listPipelines(db)).toMatchObject([{ id, name: "PowerCubus", type: "comercial", position: 0 }]);
    expect(listStages(db, id).map((s) => s.name)).toEqual(["Prospect", "Contato", "Reunião"]);
  });

  it("valida nome e etapas", async () => {
    const { db, ctx } = await freshDb();
    expect(() => createPipeline(db, ctx, { name: " ", type: "comercial", stages: [{ name: "A" }] })).toThrow(/nome do funil/);
    expect(() => createPipeline(db, ctx, { name: "X", type: "comercial", stages: [] })).toThrow(/pelo menos uma etapa/);
    expect(() => createPipeline(db, ctx, { name: "X", type: "comercial", stages: [{ name: "" }] })).toThrow(/etapa 1/);
    expect(listPipelines(db)).toHaveLength(0);
  });

  it("arquivar tira o funil da lista e dos tipos ativos", async () => {
    const { db, ctx } = await freshDb();
    const id = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo ticket" }] });
    expect(activePipelineTypes(db)).toEqual(["operacional"]);
    updatePipeline(db, ctx, id, { archived: true });
    expect(listPipelines(db)).toHaveLength(0);
    expect(listPipelines(db, { includeArchived: true })).toHaveLength(1);
    expect(activePipelineTypes(db)).toEqual([]);
  });

  it("não exclui funil com cartões", async () => {
    const { db, ctx } = await freshDb();
    const id = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }] });
    const stage = listStages(db, id)[0]!;
    insertRow(db, ctx, "deal", {
      kind: "deal",
      pipeline_id: id,
      stage_id: stage.id,
      title: "ANUP",
      stage_entered_at: new Date().toISOString(),
    });
    expect(() => deletePipeline(db, ctx, id)).toThrow(/tem cartões/);
  });
});

describe("botão + (spec 01, seção 3)", () => {
  const labels = (types: Parameters<typeof visibleQuickCreateOptions>[0]) => visibleQuickCreateOptions(types).map((o) => o.label);

  it("só funil comercial → Tarefa, Contato, Organização, Negócio", () => {
    expect(labels(["comercial"])).toEqual(["Tarefa", "Contato", "Organização", "Negócio (Comercial)"]);
  });

  it("comercial + operacional → inclui Ticket", () => {
    expect(labels(["comercial", "operacional"])).toEqual(["Tarefa", "Contato", "Organização", "Negócio (Comercial)", "Ticket (Operacional)"]);
  });

  it("sem funis → só os cadastros básicos; projeto → Etapa", () => {
    expect(labels([])).toEqual(["Tarefa", "Contato", "Organização"]);
    expect(labels(["projeto"])).toContain("Etapa (Projeto)");
  });
});
