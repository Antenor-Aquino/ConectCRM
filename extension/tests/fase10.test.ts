import { describe, expect, it } from "vitest";
import { createLossReason, createCard, moveCard, setCardStatus } from "../src/db/deals";
import { createActivity, setActivityDone } from "../src/db/activities";
import { listStages, createPipeline } from "../src/db/pipelines";
import { buildReport } from "../src/db/reports";
import { createTeam, createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import type { DatabaseSync } from "../src/db/sql";
import { freshDb } from "./helpers";

// Os testes rodam em UTC: o período é o ano de 2026 no fuso local.
const period = { from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" };
const setDates = (db: DatabaseSync, id: string, created: string, closed?: string) =>
  db.run("UPDATE deal SET created_at = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?", [created, closed ?? null, id]);

async function scenario() {
  const { db, ctx } = await freshDb();
  const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
  const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
  const bruno = createUser(db, ctx, { name: "Bruno", role: "vendedor" });
  const team = createTeam(db, ctx, { name: "Comercial", members: [{ userId: ana }, { userId: bruno }] });
  const pid = createPipeline(db, ctx, {
    name: "Vendas",
    type: "comercial",
    stages: [
      { name: "Prospect", probability: 10 },
      { name: "Proposta", probability: 50 },
      { name: "Fechamento", probability: 80 },
    ],
  });
  const [s1, s2, s3] = listStages(db, pid);
  const preco = createLossReason(db, ctx, "Preço");
  const mk = (title: string, owner: string, value: number) => createCard(db, ctx, { pipelineId: pid, title, ownerId: owner, valueCents: value });
  // Ana: 1 ganho (passou por todas), 1 perdido em Proposta, 1 aberto em Fechamento.
  const g1 = mk("Ganho Ana", ana, 100_000);
  moveCard(db, ctx, g1, { stageId: s2!.id });
  moveCard(db, ctx, g1, { stageId: s3!.id });
  setCardStatus(db, ctx, g1, { status: "won" });
  setDates(db, g1, "2026-03-01T12:00:00.000Z", "2026-03-11T12:00:00.000Z");
  const p1 = mk("Perdido Ana", ana, 50_000);
  moveCard(db, ctx, p1, { stageId: s2!.id });
  setCardStatus(db, ctx, p1, { status: "lost", lossReasonId: preco });
  setDates(db, p1, "2026-04-01T12:00:00.000Z", "2026-04-20T12:00:00.000Z");
  const o1 = mk("Aberto Ana", ana, 200_000);
  moveCard(db, ctx, o1, { stageId: s3!.id });
  setDates(db, o1, "2026-05-01T12:00:00.000Z");
  // Bruno: 1 aberto em Prospect; 1 perdido sem motivo.
  const o2 = mk("Aberto Bruno", bruno, 40_000);
  setDates(db, o2, "2026-05-02T12:00:00.000Z");
  const p2 = mk("Perdido Bruno", bruno, 10_000);
  setCardStatus(db, ctx, p2, { status: "lost" });
  setDates(db, p2, "2026-05-03T12:00:00.000Z", "2026-05-04T12:00:00.000Z");
  // Fora do período: ganho em 2025 não entra.
  const old = mk("Ganho antigo", ana, 999_000);
  setCardStatus(db, ctx, old, { status: "won" });
  setDates(db, old, "2025-01-01T12:00:00.000Z", "2025-02-01T12:00:00.000Z");
  const t1 = createActivity(db, ctx, { title: "Ligar", ownerId: ana, dueAt: "2026-05-05T12:00:00.000Z" });
  setActivityDone(db, ctx, t1, true);
  createActivity(db, ctx, { title: "Atrasada", ownerId: bruno, dueAt: "2026-05-06T12:00:00.000Z", endAt: "2026-05-07T12:00:00.000Z" });
  return { db, ctx, admin, ana, bruno, team, pid, ids: { g1, p1, o1, o2, p2 } };
}

describe("relatórios", () => {
  it("resumo: ganhos, perdidos, conversão, ticket médio, ciclo e previsão ponderada", async () => {
    const { db } = await scenario();
    const r = buildReport(db, period, new Date("2026-06-01T12:00:00.000Z"));
    expect(r.summary.won).toEqual({ count: 1, valueCents: 100_000 });
    expect(r.summary.lost).toEqual({ count: 2, valueCents: 60_000 });
    expect(r.summary.winRate).toBeCloseTo(1 / 3);
    expect(r.summary.avgTicketCents).toBe(100_000);
    expect(r.summary.avgCycleDays).toBeCloseTo(10);
    expect(r.summary.open).toEqual({ count: 2, valueCents: 240_000 });
    // 200.000 × 80% + 40.000 × 10%
    expect(r.summary.weightedCents).toBe(164_000);
    expect(r.summary.created).toBe(5);
  });

  it("funil de conversão conta até a etapa mais avançada alcançada", async () => {
    const { db, pid } = await scenario();
    const r = buildReport(db, { ...period, pipelineId: pid });
    expect(r.funnel!.map((s) => [s.name, s.reached])).toEqual([
      ["Prospect", 5],
      ["Proposta", 3],
      ["Fechamento", 2],
      ["Ganho", 1],
    ]);
    expect(r.funnel![1]!.fromPrevious).toBeCloseTo(0.6);
    expect(r.funnel![3]!.fromPrevious).toBeCloseTo(0.5);
    expect(buildReport(db, period).funnel).toBeNull();
  });

  it("previsão por etapa, meses, motivos de perda e responsáveis/equipes", async () => {
    const { db } = await scenario();
    const r = buildReport(db, period, new Date("2026-06-01T12:00:00.000Z"));
    expect(r.forecast.map((f) => [f.stageName, f.count, f.weightedCents])).toEqual([
      ["Prospect", 1, 4_000],
      ["Fechamento", 1, 160_000],
    ]);
    expect(r.months).toHaveLength(12);
    const mar = r.months.find((m) => m.month === "2026-03")!;
    expect([mar.won, mar.wonValueCents]).toEqual([1, 100_000]);
    expect(r.lossReasons.map((l) => [l.reason, l.count])).toEqual([
      ["Preço", 1],
      ["Sem motivo informado", 1],
    ]);
    const ana = r.owners.find((o) => o.name === "Ana")!;
    expect([ana.won, ana.lost, ana.open, ana.weightedCents, ana.activitiesDone]).toEqual([1, 1, 1, 160_000, 1]);
    expect(ana.winRate).toBeCloseTo(0.5);
    expect(r.teams[0]).toMatchObject({ name: "Comercial", won: 1, lost: 2, open: 2 });
    expect(r.activities.find((a) => a.name === "Bruno")).toMatchObject({ total: 1, pending: 1, overdue: 1 });
  });

  it("filtro por responsável/equipe e permissão do vendedor", async () => {
    const { db, ctx, ana, bruno, team } = await scenario();
    const asBruno = methods["reports.get"](db, { ...ctx, userId: bruno }, period);
    expect(asBruno.summary.lost.count).toBe(1);
    expect(asBruno.summary.won.count).toBe(0);
    const onlyAna = methods["reports.get"](db, ctx, { ...period, ownerId: ana });
    expect(onlyAna.summary.won.count).toBe(1);
    const byTeam = methods["reports.get"](db, ctx, { ...period, teamId: team });
    expect(byTeam.summary.lost.count).toBe(2);
  });

  it("tempo por etapa e produtos vendidos", async () => {
    const { db, ctx, pid, ids } = await scenario();
    const stages = listStages(db, pid);
    // Passagem de 2 dias em Prospect, encerrada no período.
    db.run("UPDATE deal_stage_history SET entered_at = '2026-03-01T12:00:00.000Z', left_at = '2026-03-03T12:00:00.000Z' WHERE deal_id = ? AND stage_id = ?", [ids.g1, stages[0]!.id]);
    const r = buildReport(db, { ...period, pipelineId: pid });
    const prospect = r.stageTime!.find((s) => s.name === "Prospect")!;
    // 4 passagens: a de 2 dias, duas que saíram na hora e a do perdido em
    // Prospect (encerrada no fechamento; datas forjadas no teste → 0 dia).
    expect(prospect.passages).toBe(4);
    expect(prospect.avgDays).toBeCloseTo(0.5, 2);
    expect(prospect.openNow).toBe(1);
    methods["cards.setItems"](db, ctx, { id: ids.g1, items: [{ description: "Licença anual", quantity: 2, unitPriceCents: 50_000 }] } as never);
    const r2 = buildReport(db, period);
    expect(r2.products).toEqual([{ name: "Licença anual", quantity: 2, totalCents: 100_000, deals: 1 }]);
  });
});

describe("relatórios no ambiente de teste", () => {
  it("os dados de exemplo trazem 6 meses de histórico", async () => {
    const initSqlJs = (await import("sql.js")).default;
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
    const { openDatabase } = await import("../src/db/open");
    const { db } = openDatabase(SQL, null, { seedDemo: true });
    const pipeline = (await import("../src/db/pipelines")).listPipelines(db).find((p) => p.name === "PowerCubus")!;
    const now = new Date();
    const r = buildReport(db, { from: new Date(now.getTime() - 365 * 86400_000).toISOString(), to: new Date(now.getTime() + 86400_000).toISOString(), pipelineId: pipeline.id });
    expect(r.summary.won.count).toBe(12);
    expect(r.summary.lost.count).toBe(7); // 6 do histórico + "Regina"
    expect(r.products.map((p) => p.name)).toEqual(["PowerCubus — licença anual", "Implantação"]);
    expect(r.funnel!.at(-1)).toMatchObject({ name: "Ganho", reached: 12 });
    expect(r.stageTime!.every((s) => s.passages > 0)).toBe(true);
    expect(r.lossReasons.length).toBeGreaterThanOrEqual(3);
    expect(r.activities.reduce((a, x) => a + x.done, 0)).toBeGreaterThan(10);
  });
});
