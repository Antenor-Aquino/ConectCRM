import { describe, expect, it } from "vitest";
import { createActivity, setActivityDone } from "../src/db/activities";
import { createPerson } from "../src/db/contacts";
import { createCard, moveCard, setCardStatus } from "../src/db/deals";
import { addNote } from "../src/db/notes";
import { createPipeline, listStages } from "../src/db/pipelines";
import { createTeam, createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { formatCents as brl } from "../src/lib/format";
import { freshDb } from "./helpers";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

async function crm() {
  const { db, ctx } = await freshDb();
  const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
  const ana = createUser(db, ctx, { name: "Ana Souza", role: "vendedor" });
  const bruno = createUser(db, ctx, { name: "Bruno Lima", role: "vendedor" });
  createTeam(db, ctx, { name: "Comercial", members: [{ userId: ana }, { userId: bruno }] });
  const pid = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect", probability: 10, staleDays: 7 }, { name: "Proposta", probability: 50 }] });
  const [s1, s2] = listStages(db, pid);
  const regina = createPerson(db, ctx, { name: "Regina Alves", phone: "(41) 99999-8888", email: "regina@exemplo.com" });
  const a = createCard(db, ctx, { pipelineId: pid, title: "Licenças Colégio Sol", personId: regina, ownerId: ana, valueCents: 480000 });
  moveCard(db, ctx, a, { stageId: s2!.id });
  const b = createCard(db, ctx, { pipelineId: pid, title: "Plano Escola Lua", ownerId: bruno, valueCents: 120000 });
  db.run("UPDATE deal SET stage_entered_at = ? WHERE id = ?", [ago(20), b]);
  const c = createCard(db, ctx, { pipelineId: pid, title: "Renovação Antiga", ownerId: ana, valueCents: 90000 });
  setCardStatus(db, ctx, c, { status: "won" });
  addNote(db, ctx, "deal", a, "Cliente pediu desconto de 10% na proposta.");
  const t = createActivity(db, ctx, { title: "Enviar proposta revisada", dealId: a, dueAt: ago(3), endAt: ago(2), ownerId: ana });
  const done = createActivity(db, ctx, { title: "Reunião inicial", dealId: a, dueAt: ago(5), ownerId: ana });
  setActivityDone(db, ctx, done, true);
  void s1;
  void t;
  return { db, ctx, admin, ana, bruno, ids: { a, b, c } };
}

describe("copiloto: consultas", () => {
  it("busca cartões com valores formatados e nomes resolvidos", async () => {
    const { db, ctx } = await crm();
    const r = methods["copilot.searchCards"](db, ctx, { responsavel: "ana" }) as any;
    expect(r.total).toBe(1);
    expect(r.cartoes[0]).toMatchObject({ titulo: "Licenças Colégio Sol", etapa: "Proposta", valor: brl(480000), responsavel: "Ana Souza", tarefasAtrasadas: 1 });
    expect((methods["copilot.searchCards"](db, ctx, { status: "all", responsavel: "Comercial" }) as any).total).toBe(3);
    const err = methods["copilot.searchCards"](db, ctx, { funil: "Inexistente" }) as any;
    expect(err.erro).toMatch(/Nenhum funil/);
    expect(err.opcoes).toEqual(["Vendas"]);
  });

  it("detalhe do cartão traz notas, tarefas e etapas; respeita a permissão", async () => {
    const { db, ctx, bruno, ids } = await crm();
    const d = methods["copilot.card"](db, ctx, { id: ids.a }) as any;
    expect(d.contato).toMatchObject({ nome: "Regina Alves", email: "regina@exemplo.com" });
    expect(d.ultimasNotas[0].texto).toMatch(/desconto de 10%/);
    expect(d.tarefasPendentes[0]).toMatchObject({ titulo: "Enviar proposta revisada", atrasada: true });
    expect(d.tarefasConcluidasRecentes[0].titulo).toBe("Reunião inicial");
    expect(d.etapasPercorridas.map((e: any) => e.etapa)).toEqual(["Prospect", "Proposta"]);
    const denied = methods["copilot.card"](db, { ...ctx, userId: bruno }, { id: ids.a }) as any;
    expect(denied.erro).toMatch(/sem permissão/);
  });

  it("negócios parados usam o limite da etapa (ou o informado)", async () => {
    const { db, ctx } = await crm();
    const r = methods["copilot.stale"](db, ctx, {}) as any;
    expect(r.cartoes.map((c: any) => [c.titulo, c.diasSemMovimento])).toEqual([["Plano Escola Lua", 20]]);
    expect((methods["copilot.stale"](db, ctx, { dias: 0 }) as any).total).toBe(2);
  });

  it("tarefas atrasadas, contatos por telefone e estrutura do CRM", async () => {
    const { db, ctx, bruno } = await crm();
    const late = methods["copilot.tasks"](db, ctx, { situacao: "atrasadas" }) as any;
    expect(late.tarefas[0]).toMatchObject({ titulo: "Enviar proposta revisada", atrasadaHaDias: 2, cartao: "Licenças Colégio Sol" });
    expect((methods["copilot.tasks"](db, { ...ctx, userId: bruno }, { situacao: "atrasadas" }) as any).total).toBe(0);
    const c = methods["copilot.contacts"](db, ctx, { texto: "99999-8888" }) as any;
    expect(c.contatos[0]).toMatchObject({ nome: "Regina Alves" });
    expect(c.contatos[0].cartoesAbertos[0].titulo).toBe("Licenças Colégio Sol");
    const s = methods["copilot.structure"](db) as any;
    expect(s.funis[0].etapas.map((e: any) => e.nome)).toEqual(["Prospect", "Proposta"]);
    expect(s.equipes[0].membros.sort()).toEqual(["Ana Souza", "Bruno Lima"]);
  });

  it("resumo comercial usa os números dos Relatórios", async () => {
    const { db, ctx } = await crm();
    const today = new Date();
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const r = methods["copilot.summary"](db, ctx, { de: ymd(new Date(today.getTime() - 30 * DAY)), ate: ymd(today) }) as any;
    expect(r.ganhos).toEqual({ quantidade: 1, valor: brl(90000) });
    expect(r.emAbertoHoje).toEqual({ quantidade: 2, valor: brl(600000) });
    expect(r.previsaoPonderada).toBe(brl(252000)); // 4.800 × 50% + 1.200 × 10%
    expect((methods["copilot.summary"](db, ctx, { de: "ontem", ate: "hoje" }) as any).erro).toMatch(/Período inválido/);
  });
});

describe("copiloto: agente com function calling", () => {
  type Prov = "gemini" | "openai" | "deepseek" | "claude";
  const settings = (provider: Prov) => ({ provider, keys: { [provider]: "k" }, models: {}, prompt1: "", prompt2: "" });
  const card = {
    titulo: "Negócios parados",
    subtitulo: null,
    tabela: { colunas: ["Negócio", "Dias"], linhas: [{ celulas: ["Plano Escola Lua", "20"], destaque: "alerta" }] },
    insights: [{ texto: "**1** negócio parado", tom: "alerta" }, { texto: "x", tom: "inventado" }],
    acoes: [
      { tipo: "criar_tarefa", rotulo: "Criar tarefa", cartaoId: "c1", titulo: "Ligar", quando: "2026-10-20T10:00", texto: null },
      { tipo: "apagar_tudo", rotulo: "x", cartaoId: "c1", titulo: null, quando: null, texto: null },
    ],
    sugestoes: ["E os atrasados?"],
  };
  // Respostas por provedor: 1ª chama negocios_parados; 2ª chama responder.
  const replies: Record<Prov, unknown[]> = {
    gemini: [
      { candidates: [{ content: { parts: [{ functionCall: { name: "negocios_parados", args: { dias: 14 } } }] } }] },
      { candidates: [{ content: { parts: [{ functionCall: { name: "responder", args: card } }] } }] },
    ],
    openai: [
      { choices: [{ message: { content: null, tool_calls: [{ id: "t1", function: { name: "negocios_parados", arguments: '{"dias":14}' } }] } }] },
      { choices: [{ message: { content: null, tool_calls: [{ id: "t2", function: { name: "responder", arguments: JSON.stringify(card) } }] } }] },
    ],
    deepseek: [],
    claude: [
      { content: [{ type: "tool_use", id: "u1", name: "negocios_parados", input: { dias: 14 } }], stop_reason: "tool_use" },
      { content: [{ type: "tool_use", id: "u2", name: "responder", input: card }], stop_reason: "tool_use" },
    ],
  };
  replies.deepseek = replies.openai;

  const mock = (queue: unknown[]) => {
    const bodies: any[] = [];
    const urls: string[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      urls.push(url);
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(queue.shift()), { status: 200 });
    }) as typeof fetch;
    return { bodies, urls };
  };

  for (const prov of ["gemini", "openai", "deepseek", "claude"] as Prov[]) {
    it(`${prov}: consulta, devolve o resultado à IA e monta o card normalizado`, async () => {
      const { askCopilot } = await import("../src/lib/copilot/agent");
      const { bodies, urls } = mock([...replies[prov]]);
      const calls: [string, unknown][] = [];
      const result = await askCopilot(settings(prov), [{ role: "user", content: "Quais negócios estão parados?" }], { userName: "Ana", userRole: "vendedor" }, async (n, a) => {
        calls.push([n, a]);
        return { total: 1, cartoes: [{ id: "c1", titulo: "Plano Escola Lua", diasSemMovimento: 20 }] };
      });
      expect(calls).toEqual([["negocios_parados", { dias: 14 }]]);
      expect(urls).toHaveLength(2);
      // O resultado da consulta volta na 2ª chamada.
      expect(JSON.stringify(bodies[1])).toContain("Plano Escola Lua");
      expect(result.titulo).toBe("Negócios parados");
      expect(result.insights).toEqual([{ texto: "**1** negócio parado", tom: "alerta" }, { texto: "x", tom: "neutro" }]);
      expect(result.acoes.map((a) => a.tipo)).toEqual(["criar_tarefa"]);
      expect(result.tabela!.linhas[0]!.destaque).toBe("alerta");
    });
  }

  it("resposta em texto sem ferramenta: força a ferramenta 'responder'", async () => {
    const { askCopilot } = await import("../src/lib/copilot/agent");
    const { bodies } = mock([
      { content: [{ type: "text", text: "Olá!" }], stop_reason: "end_turn" },
      { content: [{ type: "tool_use", id: "u9", name: "responder", input: { titulo: "Oi", insights: [], acoes: [], sugestoes: [] } }] },
    ]);
    const result = await askCopilot(settings("claude"), [{ role: "user", content: "oi" }], { userName: "Ana", userRole: "vendedor" }, async () => ({}));
    expect(result.titulo).toBe("Oi");
    expect(bodies[1].tool_choice).toEqual({ type: "tool", name: "responder" });
    expect(bodies[0].system).toContain("Ana (vendedor)");
  });

  it("erro do provedor vira mensagem em português", async () => {
    const { askCopilot } = await import("../src/lib/copilot/agent");
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Incorrect API key provided" } }), { status: 401 })) as typeof fetch;
    await expect(askCopilot(settings("openai"), [{ role: "user", content: "oi" }], { userName: "A", userRole: "admin" }, async () => ({}))).rejects.toThrow(/chave de API do OpenAI/);
  });
});
