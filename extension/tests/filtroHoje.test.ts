// Filtro "Hoje" (dayOnly): só as atividades do dia — começam ou terminam hoje —,
// sem as atrasadas nem as em andamento de dias anteriores; igual ao contador "Para hoje".
import { describe, expect, it } from "vitest";
import { activityCounters, createActivity, listActivities, setActivityDone } from "../src/db/activities";
import { freshDb } from "./helpers";

const at = (dayOffset: number, h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const today = () => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return { from: t.toISOString(), to: new Date(t.getTime() + 86400_000).toISOString() };
};

describe("filtro Hoje", () => {
  it("traz só as do dia", async () => {
    const { db, ctx } = await freshDb();
    const hoje = createActivity(db, ctx, { title: "Hoje 23h", dueAt: at(0, 23, 0), endAt: at(0, 23, 59) });
    const terminaHoje = createActivity(db, ctx, { title: "Termina hoje", dueAt: at(-2, 9), endAt: at(0, 23, 30) });
    createActivity(db, ctx, { title: "Atrasada", dueAt: at(-3, 9) });
    createActivity(db, ctx, { title: "Em andamento", dueAt: at(-1, 9), endAt: at(2, 18) });
    createActivity(db, ctx, { title: "Amanhã", dueAt: at(1, 9) });
    const feita = createActivity(db, ctx, { title: "Feita hoje", dueAt: at(0, 0, 1) });
    setActivityDone(db, ctx, feita, true);

    const titles = (f: Parameters<typeof listActivities>[1]) => listActivities(db, f).map((a) => a.title).sort();
    expect(titles({ ...today(), dayOnly: true, done: false })).toEqual(["Hoje 23h", "Termina hoje"]);
    expect(titles({ ...today(), dayOnly: true })).toEqual(["Feita hoje", "Hoje 23h", "Termina hoje"]);
    // Sem dayOnly (semana, mês...): continua incluindo as que estão em aberto no período.
    expect(titles({ ...today(), done: false })).toEqual(expect.arrayContaining(["Atrasada", "Em andamento", "Hoje 23h", "Termina hoje"]));
    // Mesma conta do cartão "Para hoje".
    expect(activityCounters(db).today).toBe(listActivities(db, { ...today(), dayOnly: true, done: false }).length);
    expect([hoje, terminaHoje].length).toBe(2);
  });
});
