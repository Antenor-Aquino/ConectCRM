import { describe, expect, it } from "vitest";
import { activityCounters, createActivity, dueReminders, getActivity, listActivities, markReminded, setActivityExternalEvent, updateActivity } from "../src/db/activities";
import { createPerson } from "../src/db/contacts";
import { createCard, searchCards } from "../src/db/deals";
import { runMigrations } from "../src/db/migrate";
import { createPipeline } from "../src/db/pipelines";
import { createTeam, createUser } from "../src/db/users";
import { computeFreeSlots } from "../src/lib/calendar";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

const min = 60_000;

describe("lembretes", () => {
  it("dispara no horário (vencimento - lembrete), uma vez, só para o usuário da instalação", async () => {
    const { db, ctx } = await freshDb();
    const me = createUser(db, ctx, { name: "Antenor", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const now = new Date();
    const due = new Date(now.getTime() + 10 * min).toISOString();
    const mine = createActivity(db, ctx, { title: "Ligar", dueAt: due, reminderMin: 15, ownerId: me });
    createActivity(db, ctx, { title: "Da Ana", dueAt: due, reminderMin: 15, ownerId: ana });
    createActivity(db, ctx, { title: "Ainda não", dueAt: due, reminderMin: 5, ownerId: me });
    createActivity(db, ctx, { title: "Sem lembrete", dueAt: due, reminderMin: null, ownerId: me });
    expect(dueReminders(db, me, now).map((a) => a.title)).toEqual(["Ligar"]);
    markReminded(db, ctx, [mine]);
    expect(dueReminders(db, me, now)).toEqual([]);
    // Remarcou: volta a lembrar.
    updateActivity(db, ctx, mine, { dueAt: new Date(now.getTime() + 12 * min).toISOString() });
    expect(dueReminders(db, me, now).map((a) => a.title)).toEqual(["Ligar"]);
  });

  it("não notifica tarefas vencidas há mais de um dia", async () => {
    const { db, ctx } = await freshDb();
    createActivity(db, ctx, { title: "Antiga", dueAt: new Date(Date.now() - 3 * 86400_000).toISOString() });
    expect(dueReminders(db, null)).toEqual([]);
  });
});

describe("tarefas: permissão, contadores, busca", () => {
  it("vendedor vê as suas; gestor a equipe; administrador todas", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
    const gestor = createUser(db, ctx, { name: "Gestor", role: "gestor" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
    createTeam(db, ctx, { name: "T", members: [{ userId: gestor }, { userId: ana }] });
    createActivity(db, ctx, { title: "A", ownerId: ana });
    const b = createActivity(db, ctx, { title: "B", ownerId: bia });
    const titles = (v: { id: string; role: "admin" | "gestor" | "vendedor" }) => listActivities(db, { viewer: v }).map((a) => a.title).sort();
    expect(titles({ id: admin, role: "admin" })).toEqual(["A", "B"]);
    expect(titles({ id: gestor, role: "gestor" })).toEqual(["A"]);
    expect(titles({ id: ana, role: "vendedor" })).toEqual(["A"]);
    expect(() => methods["activities.setDone"](db, { ...ctx, userId: ana }, { id: b, done: true })).toThrow(/sem permissão/);
  });

  it("contadores de atrasadas, hoje e próximos 7 dias", async () => {
    const { db, ctx } = await freshDb();
    const now = new Date(2026, 9, 16, 12, 0);
    const at = (days: number, h = 15) => new Date(2026, 9, 16 + days, h, 0).toISOString();
    createActivity(db, ctx, { title: "Atrasada", dueAt: at(-1) });
    createActivity(db, ctx, { title: "Hoje cedo (atrasada)", dueAt: at(0, 9) });
    createActivity(db, ctx, { title: "Hoje", dueAt: at(0) });
    createActivity(db, ctx, { title: "Amanhã", dueAt: at(1) });
    createActivity(db, ctx, { title: "Daqui 6", dueAt: at(6) });
    createActivity(db, ctx, { title: "Daqui 20", dueAt: at(20) });
    createActivity(db, ctx, { title: "Feita", dueAt: at(-1), done: true });
    expect(activityCounters(db, {}, now)).toEqual({ overdue: 2, today: 2, next7: 2 });
  });

  it("busca cartões para 'Vinculado a' e guarda o evento da agenda", async () => {
    const { db, ctx } = await freshDb();
    const pipelineId = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const person = createPerson(db, ctx, { name: "Regina" });
    const card = createCard(db, ctx, { pipelineId, title: "Proposta 2026", personId: person });
    expect(searchCards(db, "regina").map((c) => c.title)).toEqual(["Proposta 2026"]);
    const t = createActivity(db, ctx, { title: "Reunião", dealId: card });
    setActivityExternalEvent(db, ctx, t, { provider: "google", eventId: "ev1", meetingUrl: "https://meet.google.com/x", guests: ["a@b.com"] });
    expect(getActivity(db, t)).toMatchObject({ external_event_id: "ev1", meeting_url: "https://meet.google.com/x", guests: '["a@b.com"]' });
  });

  it("migração nova roda em banco existente", async () => {
    const { db } = await freshDb();
    expect(runMigrations(db)).toBe(0);
  });
});

describe("horários livres", () => {
  it("grade de 30 min entre 8h e 19h sem sobrepor compromissos", () => {
    const day = (h: number, m = 0) => new Date(2026, 9, 20, h, m);
    const slots = computeFreeSlots(day(8), day(11), [{ start: day(9).toISOString(), end: day(10).toISOString() }], 60);
    expect(slots.map((s) => `${s.getHours()}:${String(s.getMinutes()).padStart(2, "0")}`)).toEqual(["8:00", "10:00"]);
  });
});
