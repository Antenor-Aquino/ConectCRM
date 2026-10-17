import { describe, expect, it } from "vitest";
import {
  createActivity,
  createActivityType,
  getActivity,
  listActivities,
  listActivityTypes,
  updateActivity,
  updateActivityType,
} from "../src/db/activities";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import { addNote, listNotes, updateNote } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createProduct, createProductCategory, deleteProductCategory, listProducts } from "../src/db/products";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

describe("tarefas", () => {
  it("padrões do formulário: tipo Tarefa, agora, 5 min de duração e lembrete, responsável atual", async () => {
    const { db, ctx } = await freshDb();
    const me = createUser(db, ctx, { name: "Antenor", role: "admin" });
    const before = Date.now();
    const id = createActivity(db, { ...ctx, userId: me }, { title: "Retornar ligação" });
    const a = getActivity(db, id)!;
    const tarefa = listActivityTypes(db).find((t) => t.name === "Tarefa")!;
    expect(a).toMatchObject({ type_id: tarefa.id, duration_min: 5, reminder_min: 5, owner_id: me, done: 0, deal_id: null });
    expect(new Date(a.due_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("vinculada a um cartão herda contato e organização; sem vínculo também é válida", async () => {
    const { db, ctx } = await freshDb();
    const pipelineId = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const person = createPerson(db, ctx, { name: "Mari" });
    const org = createOrganization(db, ctx, { name: "PUC-PR", personIds: [person] });
    const deal = createCard(db, ctx, { pipelineId, title: "Mari DAC PUC-PR", personId: person });
    const linked = createActivity(db, ctx, { title: "Reunião", dealId: deal });
    expect(getActivity(db, linked)).toMatchObject({ deal_id: deal, person_id: person, organization_id: org });
    const free = createActivity(db, ctx, { title: "Organizar agenda" });
    expect(getActivity(db, free)).toMatchObject({ deal_id: null, person_id: null });
    updateActivity(db, ctx, free, { dealId: deal });
    expect(getActivity(db, free)).toMatchObject({ deal_id: deal, person_id: person });
    expect(() => createActivity(db, ctx, { title: "X", dealId: "nao-existe" })).toThrow(/não encontrado/);
  });

  it("filtros: período, atrasadas, concluídas", async () => {
    const { db, ctx } = await freshDb();
    const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
    // Atrasada: finalização vencida; sem finalização, início antes de hoje.
    createActivity(db, ctx, { title: "Ontem", dueAt: ago(30), endAt: ago(24) });
    createActivity(db, ctx, { title: "Sem prazo", dueAt: ago(48) });
    createActivity(db, ctx, { title: "Amanhã", dueAt: ago(-24) });
    createActivity(db, ctx, { title: "Feita", dueAt: ago(1), done: true });
    expect(listActivities(db, { overdue: true }).map((a) => a.title)).toEqual(["Sem prazo", "Ontem"]);
    expect(listActivities(db, { done: true }).map((a) => a.title)).toEqual(["Feita"]);
    // Daqui para frente: a pendente sem prazo (em andamento) e a de amanhã.
    expect(listActivities(db, { from: new Date().toISOString(), done: false }).map((a) => a.title)).toEqual(["Sem prazo", "Amanhã"]);
    expect(listActivities(db)[0]!.type_name).toBe("Tarefa");
  });

  it("tipos de tarefa configuráveis, mantendo ao menos um ativo", async () => {
    const { db, ctx } = await freshDb();
    createActivityType(db, ctx, { name: "Visita", icon: "map-pin" });
    expect(listActivityTypes(db).map((t) => t.name).at(-1)).toBe("Visita");
    const types = listActivityTypes(db);
    for (const t of types.slice(1)) updateActivityType(db, ctx, t.id, { active: false });
    expect(() => updateActivityType(db, ctx, types[0]!.id, { active: false })).toThrow(/pelo menos um tipo/);
  });
});

describe("notas e produtos", () => {
  it("notas fixadas aparecem primeiro", async () => {
    const { db, ctx } = await freshDb();
    const person = createPerson(db, ctx, { name: "Horário Col Pentágono" });
    const first = addNote(db, ctx, "person", person, "Primeira");
    addNote(db, ctx, "person", person, "Segunda");
    updateNote(db, ctx, first, { pinned: true });
    expect(listNotes(db, "person", person).map((n) => n.body)).toEqual(["Primeira", "Segunda"]);
    expect(() => addNote(db, ctx, "person", "nao-existe", "x")).toThrow(/não encontrado/);
  });

  it("produtos: código único, categoria com produtos não exclui", async () => {
    const { db, ctx } = await freshDb();
    const cat = createProductCategory(db, ctx, "Licenças");
    createProduct(db, ctx, { code: "LIC-01", name: "Licença anual", kind: "servico", priceCents: 120000, recurrence: "anual", categoryId: cat });
    expect(() => createProduct(db, ctx, { code: "LIC-01", name: "Outra", kind: "servico" })).toThrow(/já está em uso/);
    expect(() => deleteProductCategory(db, ctx, cat)).toThrow(/Há produtos/);
    expect(listProducts(db, { search: "lic" }).map((p) => p.name)).toEqual(["Licença anual"]);
  });
});
