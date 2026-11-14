// Calendly: agendamentos viram atividades "Reunião" no cartão certo; sem duplicar; cancelamento e remarcação.
import { describe, expect, it } from "vitest";
import { getActivity, listActivities } from "../src/db/activities";
import { importCalendlyBookings, type CalendlyBooking } from "../src/db/calendly";
import { createPerson, getPerson } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

const booking = (over: Partial<Omit<CalendlyBooking, "invitee">> & { invitee?: Partial<CalendlyBooking["invitee"]> } = {}): CalendlyBooking => ({
  eventUri: "https://api.calendly.com/scheduled_events/E1",
  status: "active",
  eventName: "Reunião 30 min",
  start: "2026-11-20T13:00:00.000Z",
  end: "2026-11-20T13:30:00.000Z",
  joinUrl: "https://meet.google.com/abc",
  account: "antenor@stepple.com.br",
  ...over,
  invitee: { name: "Jassilene Siqueira", email: "escola.20567@educacao.mg.gov.br", phone: null, dealId: null, answers: [], ...over.invitee },
});

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pid = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  return { db, ctx, pid };
}

describe("Calendly", () => {
  it("pelo link do cartão: reunião no cartão, sem duplicar ao repetir", async () => {
    const { db, ctx, pid } = await setup();
    const deal = createCard(db, ctx, { pipelineId: pid, title: "EE Doutor Guilhermino de Oliveira" });
    const r = importCalendlyBookings(db, ctx, [booking({ invitee: { dealId: deal, answers: [{ q: "Telefone", a: "(33) 98405-9659" }] } })]);
    expect(r.created).toBe(1);
    const [a] = listActivities(db, { dealId: deal });
    expect(a).toMatchObject({ title: "Reunião 30 min — Jassilene Siqueira", due_at: "2026-11-20T13:00:00.000Z" });
    const full = getActivity(db, a!.id)!;
    expect(full.meeting_url).toBe("https://meet.google.com/abc");
    expect(full.description).toContain("Telefone: (33) 98405-9659");
    expect(full.person_id).toBeTruthy(); // contato criado pelo e-mail
    expect(importCalendlyBookings(db, ctx, [booking({ invitee: { dealId: deal } })]).created).toBe(0);
  });

  it("sem link do cartão: acha o contato pelo e-mail e o único negócio aberto dele; telefone completa o cadastro", async () => {
    const { db, ctx, pid } = await setup();
    const p = createPerson(db, ctx, { name: "Jassilene", email: "ESCOLA.20567@educacao.mg.gov.br" });
    const deal = createCard(db, ctx, { pipelineId: pid, title: "Licenças", personId: p });
    importCalendlyBookings(db, ctx, [booking({ invitee: { phone: "+5533984059659" } })]);
    expect(listActivities(db, { dealId: deal })).toHaveLength(1);
    expect(getPerson(db, p)!.phone).toBe("+5533984059659");
    // Dois negócios abertos: fica só no contato.
    createCard(db, ctx, { pipelineId: pid, title: "Outro", personId: p });
    importCalendlyBookings(db, ctx, [booking({ eventUri: "E2" })]);
    expect(listActivities(db, { personId: p }).filter((a) => !a.deal_id).map((a) => a.title)).toEqual(["Reunião 30 min — Jassilene Siqueira"]);
  });

  it("remarcado muda o horário; cancelado e remarcado no Calendly ficam concluídos com aviso", async () => {
    const { db, ctx, pid } = await setup();
    const deal = createCard(db, ctx, { pipelineId: pid, title: "Cartão" });
    importCalendlyBookings(db, ctx, [booking({ invitee: { dealId: deal } })]);
    const r = importCalendlyBookings(db, ctx, [booking({ start: "2026-11-21T14:00:00.000Z", end: "2026-11-21T15:00:00.000Z", invitee: { dealId: deal } })]);
    expect(r.updated).toBe(1);
    let [a] = listActivities(db, { dealId: deal });
    expect(a!.due_at).toBe("2026-11-21T14:00:00.000Z");
    importCalendlyBookings(db, ctx, [booking({ status: "canceled", invitee: { dealId: deal, rescheduled: true } })]);
    [a] = listActivities(db, { dealId: deal });
    expect([a!.title, !!a!.done]).toEqual(["Remarcada: Reunião 30 min — Jassilene Siqueira", true]);
    // Cancelado de novo não repete o aviso.
    expect(importCalendlyBookings(db, ctx, [booking({ status: "canceled", invitee: { dealId: deal } })]).canceled).toBe(0);
  });
});

describe("Calendly — link e leitura", async () => {
  const { bookingLink, toBooking, accountForPipeline } = await import("../src/lib/calendly");
  it("link preenchido com contato e marca do cartão", () => {
    const u = new URL(bookingLink("https://calendly.com/antenor/30min", { name: "Ana Souza", email: "ana@x.com", dealId: "D1" }));
    expect(Object.fromEntries(u.searchParams)).toEqual({ name: "Ana Souza", email: "ana@x.com", utm_source: "conectcrm", utm_content: "D1" });
  });
  it("convidado vira agendamento: cartão só pela marca do CRM; telefone pelo SMS ou pela pergunta", () => {
    const ev = { uri: "E", name: "Reunião", status: "active" as const, start_time: "a", end_time: "b", updated_at: "u", location: { join_url: "https://zoom/x" } };
    const b = toBooking("c@x", ev, { name: "Ana", email: "a@x", status: "active", questions_and_answers: [{ question: "Seu WhatsApp", answer: "(31) 99999-0000" }], tracking: { utm_source: "conectcrm", utm_content: "D1" } });
    expect(b.invitee).toMatchObject({ phone: "(31) 99999-0000", dealId: "D1" });
    expect(b.joinUrl).toBe("https://zoom/x");
    expect(toBooking("c@x", ev, { name: "Ana", email: "a@x", status: "active", tracking: { utm_source: "google", utm_content: "D1" } }).invitee.dealId).toBeNull();
  });
  it("conta do funil; senão a primeira", () => {
    const acc = (email: string) => ({ token: "t", email, name: email, userUri: "", eventTypes: [], eventTypeUri: null });
    const s = { accounts: [acc("a@x"), acc("b@x")], pipelineAccount: { P2: "b@x" }, lastSyncAt: null, lastError: null };
    expect(accountForPipeline(s, "P2")!.email).toBe("b@x");
    expect(accountForPipeline(s, "P1")!.email).toBe("a@x");
  });
});
