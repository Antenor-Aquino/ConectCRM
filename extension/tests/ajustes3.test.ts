import { describe, expect, it } from "vitest";
import { createActivity } from "../src/db/activities";
import { createOrganization } from "../src/db/contacts";
import { createCard, getBoard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { isOverdue } from "../src/lib/taskTiming";
import { freshDb } from "./helpers";

describe("tarefa atrasada (regra única)", () => {
  const now = new Date(2026, 9, 17, 10, 0);
  const at = (d: number, h = 9) => new Date(2026, 9, 17 + d, h, 0).toISOString();
  it("finalização vencida; sem finalização, início antes de hoje", () => {
    expect(isOverdue({ due_at: at(-3), end_at: at(-1), done: 0 }, now)).toBe(true);
    expect(isOverdue({ due_at: at(-10), end_at: null, done: 0 }, now)).toBe(true);
    expect(isOverdue({ due_at: at(0, 8), end_at: null, done: 0 }, now)).toBe(false); // começou hoje
    expect(isOverdue({ due_at: at(-3), end_at: at(2), done: 0 }, now)).toBe(false); // finalização no futuro
    expect(isOverdue({ due_at: at(-10), end_at: null, done: 1 }, now)).toBe(false);
  });
});

describe("funil em lista", () => {
  it("colunas escolhidas pelo usuário (inválidas ignoradas) e próxima tarefa atrasada em vermelho", async () => {
    const { db, ctx } = await freshDb();
    const pid = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }, { name: "Proposta" }] });
    const org = createOrganization(db, ctx, { name: "PUC-PR", city: "Curitiba", state: "PR" });
    const id = createCard(db, ctx, { pipelineId: pid, title: "Licenças", organizationId: org, valueCents: 480000 });
    createActivity(db, ctx, { title: "Ligar", dealId: id, dueAt: new Date(Date.now() - 5 * 86400_000).toISOString() });
    const cols = getBoard(db, pid, { fieldKeys: ["org_cidade", "proxima_tarefa", "bogus", "<script>"] });
    const card = cols[0]!.cards[0]!;
    expect(Object.keys(card.fields).sort()).toEqual(["org_cidade", "proxima_tarefa"]);
    expect(card.fields.org_cidade).toEqual({ text: "Curitiba / PR" });
    expect(card.fields.proxima_tarefa).toMatchObject({ tone: "danger" });
    // Sem fieldKeys: campos configurados no cartão do funil (padrão comercial).
    expect(Object.keys(getBoard(db, pid)[0]!.cards[0]!.fields).sort()).toEqual(["contato", "valor"]); // contato sem pessoa mostra a organização
  });
});
