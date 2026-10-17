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
    expect(translateError("Either the '<all_urls>' or 'activeTab' permission is required.")).toMatch(/não deu permissão/);
    expect(translateError("Cannot access contents of the page.")).toMatch(/O Chrome não permite/);
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

describe("copiloto: criar cartão e nomes ditados", () => {
  it("busca tolera nome parecido; estrutura traz ids; ação criar_cartao é aceita", async () => {
    const { searchCardsForCopilot, crmStructure } = await import("../src/db/copilot");
    const { normalizeCard } = await import("../src/lib/copilot/tools");
    const { db, ctx } = await freshDb();
    const casa = createPipeline(db, ctx, { name: "Casa", type: "projeto", stages: [{ name: "A fazer" }, { name: "Feito" }] });
    createCard(db, ctx, { pipelineId: casa, title: "Conserto Gaveta Miguel" });
    const r = searchCardsForCopilot(db, null, { texto: "Concerto Gaveta de Miguel" }) as any;
    expect(r.cartoes.map((c: any) => [c.titulo, c.nomeParecido])).toEqual([["Conserto Gaveta Miguel", true]]);
    expect((searchCardsForCopilot(db, null, { texto: "gaveta" }) as any).cartoes[0].nomeParecido).toBeUndefined();
    const s = crmStructure(db);
    expect(s.funis[0]).toMatchObject({ id: casa, nome: "Casa", etapas: [{ nome: "A fazer" }, { nome: "Feito" }] });
    expect(s.funis[0]!.etapas[0]!.id).toBeTruthy();
    const card = normalizeCard({
      titulo: "Criar cartão",
      acoes: [
        { tipo: "criar_cartao", rotulo: "Criar cartão", cartaoId: "", titulo: "Conserto", funilId: casa, etapaId: null },
        { tipo: "criar_cartao", rotulo: "Sem funil", cartaoId: "", titulo: "X", funilId: null },
      ],
    });
    expect(card.acoes).toEqual([{ tipo: "criar_cartao", rotulo: "Criar cartão", cartaoId: "", titulo: "Conserto", funilId: casa, etapaId: null, quando: null, texto: null }]);
  });
});

describe("histórico com origem clicável", () => {
  it("nota, tarefa e documento que ainda existem viram link; excluídos não", async () => {
    const { cardHistory } = await import("../src/db/cardHistory");
    const { addNote, deleteNote } = await import("../src/db/notes");
    const { db, ctx } = await freshDb();
    const pid = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const id = createCard(db, ctx, { pipelineId: pid, title: "Licenças" });
    const note = addNote(db, ctx, "deal", id, "Primeira nota");
    const gone = addNote(db, ctx, "deal", id, "Nota apagada");
    deleteNote(db, ctx, gone);
    const task = createActivity(db, ctx, { title: "Ligar", dealId: id });
    db.run("UPDATE change_log SET at = strftime('%Y-%m-%dT%H:%M:%fZ', at, '-1 minute')");
    const pairs = cardHistory(db, id).flatMap((e) => e.lines.map((l, i) => [l, e.refs[i]]));
    const refOf = (start: string) => pairs.find(([l]) => String(l).startsWith(start))?.[1];
    expect(refOf("Adicionou nota: \"Primeira")).toEqual({ kind: "note", id: note });
    expect(refOf("Adicionou nota: \"Nota apagada")).toBeNull();
    expect(refOf("Criou a tarefa")).toEqual({ kind: "activity", id: task });
    expect(refOf("Criou o cartão")).toBeNull();
  });
});

describe("copiloto aberto num cartão", () => {
  it("instruções citam o cartão; ações sem cartão usam o aberto; tabela vazia some", async () => {
    const { buildSystemPrompt } = await import("../src/lib/copilot/agent");
    const { normalizeCard } = await import("../src/lib/copilot/tools");
    const p = buildSystemPrompt({ userName: "Antenor", userRole: "administrador", cardId: "c1", cardTitle: "Ajeitar a Gaveta de Miguel" });
    expect(p).toMatch(/aberto no cartão "Ajeitar a Gaveta de Miguel" \(id c1\)/);
    expect(p).toMatch(/use cartaoId c1/);
    expect(buildSystemPrompt({ userName: "Antenor", userRole: "administrador" })).not.toMatch(/CONTEXTO DO CARTÃO/);
    const card = normalizeCard(
      {
        titulo: "Tarefa",
        tabela: { colunas: ["Título"], linhas: [] },
        acoes: [
          { tipo: "criar_tarefa", rotulo: "Criar tarefa", cartaoId: "", titulo: "Colar gaveta", quando: "2026-10-18T08:00" },
          { tipo: "abrir_cartao", rotulo: "Abrir outro", cartaoId: "c2" },
        ],
      },
      "c1",
    );
    expect(card.tabela).toBeNull();
    expect(card.acoes.map((a) => [a.tipo, a.cartaoId])).toEqual([["criar_tarefa", "c1"], ["abrir_cartao", "c2"]]);
    expect(normalizeCard({ acoes: [{ tipo: "criar_tarefa", rotulo: "x", cartaoId: "", titulo: "y" }] }).acoes).toEqual([]);
  });
});
