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

describe("sistema em português", () => {
  it("tipos de tarefa padrão, cores e erros do navegador traduzidos", async () => {
    const { listActivityTypes } = await import("../src/db/activities");
    const { COLOR_LABEL } = await import("../src/lib/colors");
    const { translateError } = await import("../src/lib/errors");
    const { db } = await freshDb();
    expect(listActivityTypes(db).map((t) => t.name)).toContain("Prazo final");
    expect(listActivityTypes(db).map((t) => t.name)).not.toContain("Deadline");
    expect(Object.values(COLOR_LABEL)).toEqual(["Azul", "Roxo", "Verde", "Âmbar", "Vermelho", "Ciano", "Cinza"]);
    expect(translateError("Failed to fetch")).toMatch(/Sem conexão/);
    expect(translateError("The user did not approve access.")).toMatch(/Login cancelado/);
    expect(translateError("Either the '<all_urls>' or 'activeTab' permission is required.")).toMatch(/O Chrome não permite/);
    expect(translateError("Informe o nome.")).toBe("Informe o nome.");
  });

  it("migração renomeia o tipo Deadline das bases antigas", async () => {
    const { runMigrations } = await import("../src/db/migrate");
    const { db } = await freshDb();
    db.run("UPDATE activity_type SET name = 'Deadline' WHERE name = 'Prazo final'");
    db.run("DELETE FROM _migrations WHERE name = '0007_tipo_prazo_final.sql'");
    runMigrations(db);
    expect(db.exec("SELECT COUNT(*) FROM activity_type WHERE name = 'Prazo final'")[0]!.values[0]![0]).toBe(1);
  });
});
