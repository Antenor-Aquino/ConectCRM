// Filtros avançados das Atividades: tipo de funil, funis e cartão (e a busca de cartões do filtro).
import { describe, expect, it } from "vitest";
import { activityCounters, createActivity, listActivities } from "../src/db/activities";
import { createOrganization } from "../src/db/contacts";
import { createCard, searchCards } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { advancedFilterCount, advancedFilterParams, EMPTY_ADVANCED_FILTER } from "../src/dashboard/tasks/ActivityFilterDrawer";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const vendas = createPipeline(db, ctx, { name: "Certificados", type: "comercial", stages: [{ name: "Prospecção" }] });
  const power = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Proposta" }] });
  const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Aberto" }] });
  const educti = createOrganization(db, ctx, { name: "Educti" });
  const a = createCard(db, ctx, { pipelineId: vendas, title: "Claudia Teste", organizationId: educti });
  const b = createCard(db, ctx, { pipelineId: power, title: "EE Jose Cristiano Alves" });
  const c = createCard(db, ctx, { pipelineId: suporte, title: "Chamado impressora" });
  const due = new Date(Date.now() + 3600_000).toISOString();
  createActivity(db, ctx, { title: "Ligar Claudia", dealId: a, dueAt: due });
  createActivity(db, ctx, { title: "Cobrar boleto", dealId: b, dueAt: due });
  createActivity(db, ctx, { title: "Visita técnica", dealId: c, dueAt: due });
  createActivity(db, ctx, { title: "Organizar agenda", dueAt: due });
  return { db, ctx, vendas, power, suporte, a, b, c };
}
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe("Atividades — filtros avançados", () => {
  it("por tipo de funil, por funis e por cartão (combinados); contadores seguem o filtro", async () => {
    const { db, vendas, power, a } = await setup();
    expect(titles(listActivities(db, {}))).toHaveLength(4);
    expect(titles(listActivities(db, { pipelineTypes: ["comercial"] }))).toEqual(["Cobrar boleto", "Ligar Claudia"]);
    expect(titles(listActivities(db, { pipelineTypes: ["operacional"] }))).toEqual(["Visita técnica"]);
    expect(titles(listActivities(db, { pipelineIds: [vendas] }))).toEqual(["Ligar Claudia"]);
    expect(titles(listActivities(db, { pipelineIds: [vendas, power] }))).toEqual(["Cobrar boleto", "Ligar Claudia"]);
    expect(titles(listActivities(db, { pipelineTypes: ["operacional"], pipelineIds: [vendas] }))).toEqual([]);
    expect(titles(listActivities(db, { dealId: a }))).toEqual(["Ligar Claudia"]);
    expect(activityCounters(db, { pipelineTypes: ["comercial"] }).today + activityCounters(db, { pipelineTypes: ["comercial"] }).next7).toBe(2);
  });

  it("por etiqueta da atividade ou do cartão", async () => {
    const { db, ctx, a, c } = await setup();
    const { createTag, setEntityTags } = await import("../src/db/tags");
    const quente = createTag(db, ctx, { entity: "deal", name: "QUENTE" });
    const urgente = createTag(db, ctx, { entity: "activity", name: "Urgente" });
    setEntityTags(db, ctx, "deal", a, [quente]);
    const visita = listActivities(db, { dealId: c })[0]!;
    setEntityTags(db, ctx, "activity", visita.id, [urgente]);
    expect(titles(listActivities(db, { tagIds: [quente] }))).toEqual(["Ligar Claudia"]);
    expect(titles(listActivities(db, { tagIds: [urgente] }))).toEqual(["Visita técnica"]);
    expect(titles(listActivities(db, { tagIds: [quente, urgente] }))).toEqual(["Ligar Claudia", "Visita técnica"]);
    expect(titles(listActivities(db, { tagIds: [quente], pipelineTypes: ["operacional"] }))).toEqual([]);
  });

  it("busca de cartões do filtro: por título, organização, limitada aos funis/tipo escolhidos", async () => {
    const { db, vendas, suporte } = await setup();
    expect(searchCards(db, "educti").map((c) => c.title)).toEqual(["Claudia Teste"]);
    expect(searchCards(db, "", null, 10, { pipelineTypes: ["operacional"] }).map((c) => c.title)).toEqual(["Chamado impressora"]);
    expect(searchCards(db, "", null, 10, { pipelineIds: [vendas, suporte] }).map((c) => c.title).sort()).toEqual(["Chamado impressora", "Claudia Teste"]);
  });

  it("parâmetros e contagem dos filtros da tela", () => {
    expect(advancedFilterCount(EMPTY_ADVANCED_FILTER)).toBe(0);
    expect(advancedFilterParams(EMPTY_ADVANCED_FILTER)).toEqual({});
    const f = { pipelineType: "comercial" as const, pipelineIds: ["p1"], card: { id: "c1", label: "Claudia" }, tagIds: ["t1", "t2"] };
    expect(advancedFilterCount(f)).toBe(4);
    expect(advancedFilterParams(f)).toEqual({ pipelineTypes: ["comercial"], pipelineIds: ["p1"], dealId: "c1", tagIds: ["t1", "t2"] });
  });
});
