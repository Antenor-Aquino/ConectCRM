// Atividades recorrentes: regras de calendário (lib/recurrence) e a série no
// banco (janela de 60 dias, alterar/excluir esta, as próximas ou todas,
// encerrar, repetir só depois de concluir, lixeira).
import { describe, expect, it } from "vitest";
import { getActivity, listActivities, setActivityDone } from "../src/db/activities";
import * as series from "../src/db/activitySeries";
import { listTrash, restoreTrashItem } from "../src/db/trash";
import { createUser, getViewer } from "../src/db/users";
import { describeRule, monthlyOrdinal, nextAfterDone, occurrences, type RecurrenceRule } from "../src/lib/recurrence";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

const d = (s: string) => new Date(s);
const dates = (rule: RecurrenceRule, start: string, to: string) => occurrences(rule, d(start), d(to)).map((o) => o.at.toISOString().slice(0, 10));
const never = { type: "never" } as const;

describe("regras de recorrência", () => {
  it("diária, a cada X dias e só dias úteis", () => {
    expect(dates({ freq: "daily", interval: 1, end: never }, "2026-10-22T09:00", "2026-10-25T23:00")).toEqual(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(dates({ freq: "daily", interval: 15, end: never }, "2026-10-01T09:00", "2026-11-30T23:00")).toEqual(["2026-10-01", "2026-10-16", "2026-10-31", "2026-11-15", "2026-11-30"]);
    // 23/10/2026 é sexta
    expect(dates({ freq: "daily", interval: 1, workdaysOnly: true, end: never }, "2026-10-23T09:00", "2026-10-27T23:00")).toEqual(["2026-10-23", "2026-10-26", "2026-10-27"]);
  });

  it("semanal em vários dias e a cada 2 semanas", () => {
    // 22/10/2026 é quinta; segunda e quarta
    expect(dates({ freq: "weekly", interval: 1, weekdays: [1, 3], end: never }, "2026-10-22T09:00", "2026-11-04T23:00")).toEqual([
      "2026-10-26",
      "2026-10-28",
      "2026-11-02",
      "2026-11-04",
    ]);
    expect(dates({ freq: "weekly", interval: 2, end: never }, "2026-10-22T09:00", "2026-11-20T23:00")).toEqual(["2026-10-22", "2026-11-05", "2026-11-19"]);
  });

  it("mensal no dia 31 cai no último dia; mensal na 2ª terça e na última sexta", () => {
    expect(dates({ freq: "monthly", interval: 1, end: never }, "2026-01-31T09:00", "2026-04-30T23:00")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    // 13/10/2026 é a 2ª terça
    expect(monthlyOrdinal(d("2026-10-13T09:00"))).toEqual({ nth: 2, weekday: 2 });
    expect(dates({ freq: "monthly", interval: 1, monthly: "weekday", end: never }, "2026-10-13T09:00", "2026-12-31T23:00")).toEqual(["2026-10-13", "2026-11-10", "2026-12-08"]);
    // 30/10/2026 é a última sexta
    expect(dates({ freq: "monthly", interval: 1, monthly: "weekday", end: never }, "2026-10-30T09:00", "2026-12-31T23:00")).toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
  });

  it("anual em 29/02 cai em 28/02 nos anos comuns", () => {
    expect(dates({ freq: "yearly", interval: 1, end: never }, "2028-02-29T09:00", "2031-12-31T23:00")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28"]);
  });

  it("termina em data ou após N vezes; mantém a hora", () => {
    expect(dates({ freq: "daily", interval: 1, end: { type: "until", date: "2026-10-24" } }, "2026-10-22T09:00", "2027-01-01")).toHaveLength(3);
    const occ = occurrences({ freq: "weekly", interval: 1, end: { type: "count", count: 3 } }, d("2026-10-22T14:30"), d("2027-12-31"));
    expect(occ.map((o) => [o.index, o.at.getHours(), o.at.getMinutes()])).toEqual([
      [1, 14, 30],
      [2, 14, 30],
      [3, 14, 30],
    ]);
  });

  it("próxima depois de concluir conta da conclusão", () => {
    const next = nextAfterDone({ freq: "daily", interval: 30, end: never, afterDone: true }, d("2026-10-01T09:00"), d("2026-10-20T17:45"));
    expect([next.toISOString().slice(0, 10), next.getHours()]).toEqual(["2026-11-19", 9]);
  });

  it("frase da regra", () => {
    expect(describeRule({ freq: "weekly", interval: 1, weekdays: [1, 3], end: { type: "until", date: "2026-12-30" } }, d("2026-10-26T09:00"))).toBe(
      "Toda semana: segunda e quarta às 09:00, até 30/12/2026",
    );
    expect(describeRule({ freq: "daily", interval: 15, end: never }, d("2026-10-26T09:00"))).toBe("A cada 15 dias às 09:00, sem data final");
  });
});

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const admin = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: admin };
  return { db, ctx, sys, admin };
}
const now = d("2026-10-22T08:00");
const occ = (db: Parameters<typeof listActivities>[0], seriesId: string) =>
  listActivities(db, { limit: 500 })
    .filter((a) => a.series_id === seriesId)
    .sort((a, b) => a.series_index! - b.series_index!);

describe("séries no banco", () => {
  it("sem data final cria só os próximos 60 dias e completa depois", async () => {
    const { db, ctx } = await setup();
    const { seriesId, firstId } = series.createSeries(db, ctx, { title: "Relatório semanal", dueAt: "2026-10-22T09:00:00", recurrence: { freq: "weekly", interval: 1, end: never } }, now);
    expect(occ(db, seriesId)).toHaveLength(9); // 22/10 … 17/12
    expect(getActivity(db, firstId!)!.title).toBe("Relatório semanal");
    expect(series.topUpSeries(db, ctx, seriesId, now)).toHaveLength(0);
    // um mês depois a janela anda
    expect(series.topUpSeries(db, ctx, seriesId, d("2026-11-22T08:00"))).toHaveLength(4);
  });

  it("início no passado começa hoje; lembretes e vínculos vão para todas", async () => {
    const { db, ctx } = await setup();
    const { seriesId } = series.createSeries(
      db,
      ctx,
      { title: "Conferir caixa", dueAt: "2026-10-01T18:00:00", reminders: [{ minutesBefore: 10, channels: ["chrome"] }], recurrence: { freq: "daily", interval: 1, end: { type: "count", count: 30 } } },
      now,
    );
    const list = occ(db, seriesId);
    expect(list[0]!.due_at.slice(0, 10)).toBe("2026-10-22");
    expect(list.at(-1)!.series_index).toBe(30);
    expect(list).toHaveLength(9); // índices 22…30 (as de 1 a 21 ficaram no passado)
    expect(getActivity(db, list[0]!.id)!.reminders).toEqual([{ minutesBefore: 10, channels: ["chrome"] }]);
  });

  it("alterar só esta, esta e as próximas, ou todas", async () => {
    const { db, ctx } = await setup();
    const { seriesId } = series.createSeries(db, ctx, { title: "Daily", dueAt: "2026-10-22T09:00:00", recurrence: { freq: "daily", interval: 1, end: { type: "count", count: 10 } } }, now);
    let list = occ(db, seriesId);
    // todas (só campos): no lugar
    series.updateSeries(db, ctx, list[0]!.id, "all", { title: "Daily da equipe" }, undefined, now);
    expect(occ(db, seriesId).every((a) => a.title === "Daily da equipe")).toBe(true);
    expect(occ(db, seriesId)[0]!.id).toBe(list[0]!.id);
    // esta e as próximas, mudando a hora a partir da 4ª: divide a série
    list = occ(db, seriesId);
    series.updateSeries(db, ctx, list[3]!.id, "following", { dueAt: "2026-10-25T10:30:00" }, undefined, now);
    const old = occ(db, seriesId);
    expect(old.map((a) => a.series_index)).toEqual([1, 2, 3]);
    const all = listActivities(db, { limit: 500 }).filter((a) => a.title === "Daily da equipe");
    expect(all).toHaveLength(10);
    expect(all.filter((a) => new Date(a.due_at).getHours() === 10)).toHaveLength(7);
  });

  it("excluir só esta não volta; esta e as próximas encerra; restaurar devolve", async () => {
    const { db, ctx, admin } = await setup();
    const { seriesId } = series.createSeries(db, ctx, { title: "Ronda", dueAt: "2026-10-22T09:00:00", recurrence: { freq: "daily", interval: 1, end: { type: "count", count: 6 } } }, now);
    let list = occ(db, seriesId);
    series.deleteFromSeries(db, ctx, list[1]!.id, "this");
    expect(series.topUpSeries(db, ctx, seriesId, now)).toHaveLength(0);
    expect(occ(db, seriesId).map((a) => a.series_index)).toEqual([1, 3, 4, 5, 6]);
    list = occ(db, seriesId);
    series.deleteFromSeries(db, ctx, list[2]!.id, "following"); // a partir da 4
    expect(occ(db, seriesId).map((a) => a.series_index)).toEqual([1, 3]);
    expect(series.topUpSeries(db, ctx, seriesId, now)).toHaveLength(0);
    const v = getViewer(db, admin);
    const item = listTrash(db, v)[0]!;
    restoreTrashItem(db, ctx, v, item.id);
    expect(occ(db, seriesId).map((a) => a.series_index)).toEqual([1, 3, 4, 5, 6]);
  });

  it("excluir todas tira as pendentes e a série; as concluídas ficam", async () => {
    const { db, ctx } = await setup();
    const { seriesId } = series.createSeries(db, ctx, { title: "Backup", dueAt: "2026-10-22T09:00:00", recurrence: { freq: "daily", interval: 1, end: never } }, now);
    const list = occ(db, seriesId);
    setActivityDone(db, ctx, list[0]!.id, true);
    series.deleteFromSeries(db, ctx, list[3]!.id, "all");
    expect(occ(db, seriesId).map((a) => a.series_index)).toEqual([1]);
    expect(series.getSeries(db, seriesId)).toBeUndefined();
    expect(series.topUpAllSeries(db, ctx, d("2026-12-01"))).toBe(0);
  });

  it("encerrar série sem data final", async () => {
    const { db, ctx } = await setup();
    const { seriesId, firstId } = series.createSeries(db, ctx, { title: "Follow-up", dueAt: "2026-10-22T09:00:00", recurrence: { freq: "weekly", interval: 1, end: never } }, now);
    expect(series.endSeries(db, ctx, seriesId, "2026-11-05")).toBe(6);
    expect(occ(db, seriesId)).toHaveLength(3);
    expect(series.topUpSeries(db, ctx, seriesId, d("2026-12-30"))).toHaveLength(0);
    expect(series.seriesOfActivity(db, firstId!)!.rule.end).toEqual({ type: "until", date: "2026-11-05" });
  });

  it("repetir só depois de concluir: uma por vez, contando da conclusão", async () => {
    const { db, ctx } = await setup();
    const { seriesId, firstId } = series.createSeries(
      db,
      ctx,
      { title: "Ligar para o cliente", dueAt: "2026-10-22T09:00:00", recurrence: { freq: "daily", interval: 30, afterDone: true, end: never } },
      now,
    );
    expect(occ(db, seriesId)).toHaveLength(1);
    setActivityDone(db, ctx, firstId!, true);
    const nextId = series.afterOccurrenceDone(db, ctx, firstId!, now);
    const next = getActivity(db, nextId!)!;
    expect(new Date(next.due_at).getHours()).toBe(9);
    expect(occ(db, seriesId).filter((a) => !a.done)).toHaveLength(1);
  });

  it("pelo RPC: criar com recorrência, transformar atividade comum e a regra para a tela", async () => {
    const { db, sys, admin } = await setup();
    const as = { ...sys, userId: admin };
    const first = methods["activities.create"](db, as, { title: "Visita", dueAt: new Date(Date.now() + 3600_000).toISOString(), recurrence: { freq: "monthly", interval: 1, end: { type: "count", count: 3 } } });
    expect(methods["activities.series"](db, as, { id: first })!.index).toBe(1);
    const plain = methods["activities.create"](db, as, { title: "Reunião de pauta", dueAt: new Date(Date.now() + 7200_000).toISOString() });
    methods["activities.update"](db, as, { id: plain, patch: { title: "Reunião de pauta" }, recurrence: { freq: "weekly", interval: 1, end: { type: "count", count: 4 } } });
    const s = methods["activities.series"](db, as, { id: plain })!;
    expect(s.index).toBe(1);
    expect(listActivities(db, { limit: 500 }).filter((a) => a.series_id === s.id)).toHaveLength(4);
  });
});
