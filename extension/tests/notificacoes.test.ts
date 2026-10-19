import { describe, expect, it } from "vitest";
import { createActivity, getActivity, updateActivity } from "../src/db/activities";
import { activityDeliveries, listActivityReminders, planNotifications, recordDeliveries, type NotifyJob } from "../src/db/notifications";
import { createUser } from "../src/db/users";
import { inQuietHours, leadLabel, withDefaults, type NotifySettings } from "../src/lib/notify/settings";
import { freshDb } from "./helpers";

const at = (s: string) => new Date(s);
const ok = (jobs: NotifyJob[]) =>
  jobs.map((j) => ({ key: j.key, channel: j.channel, kind: j.kind, userId: j.userId, activityId: j.activityId, title: j.title, ok: true }));

async function setup() {
  const { db, ctx } = await freshDb();
  const ana = createUser(db, ctx, { name: "Ana", role: "admin" });
  const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
  const actx = { ...ctx, userId: ana };
  const full: Partial<NotifySettings> = {
    chrome: true,
    email: { enabled: true, to: "ana@x.com" },
    whatsapp: { enabled: true, phone: "+5541999998888", apikey: "k" },
  };
  return { db, actx, ana, bia, settings: { [ana]: full, [bia]: { ...full, email: { enabled: true, to: "bia@x.com" } } } };
}

describe("lembretes da atividade", () => {
  it("vários lembretes por atividade; o lembrete antigo (minutos) vira um do Chrome", async () => {
    const { db, actx } = await setup();
    const a = createActivity(db, actx, { title: "Ligar", dueAt: "2026-11-02T13:00:00.000Z" });
    expect(listActivityReminders(db, a)).toEqual([{ minutesBefore: 5, channels: ["chrome"] }]);
    updateActivity(db, actx, a, {
      reminders: [
        { minutesBefore: 1440, channels: ["email"] },
        { minutesBefore: 30, channels: ["whatsapp", "chrome"] },
        { minutesBefore: 30, channels: ["email"] },
        { minutesBefore: 5, channels: [] },
      ],
    });
    expect(getActivity(db, a)!.reminders).toEqual([
      { minutesBefore: 1440, channels: ["email"] },
      { minutesBefore: 30, channels: ["whatsapp", "chrome", "email"] },
    ]);
    expect(getActivity(db, a)!.reminder_min).toBe(30);
  });
});

describe("o que avisar", () => {
  it("na hora certa, uma vez por canal; Chrome só para quem está no computador; remarcar avisa de novo", async () => {
    const { db, actx, ana, bia, settings } = await setup();
    const a = createActivity(db, actx, { title: "Reunião Alfa", dueAt: "2026-11-02T13:00:00.000Z", reminders: [{ minutesBefore: 60, channels: ["chrome", "email", "whatsapp"] }] });
    const b = createActivity(db, actx, { title: "Ligar Beta", ownerId: bia, dueAt: "2026-11-02T13:00:00.000Z", reminders: [{ minutesBefore: 60, channels: ["chrome", "email"] }] });
    expect(planNotifications(db, at("2026-11-02T11:59:00Z"), settings, ana)).toEqual([]);
    const jobs = planNotifications(db, at("2026-11-02T12:00:30Z"), settings, ana);
    expect(jobs.map((j) => [j.activityId === a ? "A" : "B", j.channel, j.userId === ana ? "ana" : "bia"]).sort()).toEqual([
      ["A", "chrome", "ana"],
      ["A", "email", "ana"],
      ["A", "whatsapp", "ana"],
      ["B", "email", "bia"], // Chrome da Bia não toca no computador da Ana
    ]);
    expect(jobs[0]!.text).toMatch(/Reunião Alfa|Ligar Beta/);
    recordDeliveries(db, ok(jobs), at("2026-11-02T12:00:40Z"));
    expect(planNotifications(db, at("2026-11-02T12:01:00Z"), settings, ana)).toEqual([]);
    expect(activityDeliveries(db, a).map((d) => [d.channel, d.status]).sort()).toEqual([
      ["chrome", "sent"],
      ["email", "sent"],
      ["whatsapp", "sent"],
    ]);
    updateActivity(db, actx, b, { dueAt: "2026-11-02T14:00:00.000Z" });
    expect(planNotifications(db, at("2026-11-02T13:00:30Z"), settings, ana).map((j) => j.title)).toEqual(["Lembrete: Ligar Beta"]);
  });

  it("falha tenta de novo em 5 e 15 min; na terceira, desiste e avisa", async () => {
    const { db, actx, ana, settings } = await setup();
    createActivity(db, actx, { title: "X", dueAt: "2026-11-02T14:00:00.000Z", reminders: [{ minutesBefore: 70, channels: ["whatsapp"] }] });
    const t0 = at("2026-11-02T12:50:00Z");
    const fail = (jobs: NotifyJob[], now: Date) => recordDeliveries(db, ok(jobs).map((r) => ({ ...r, ok: false, error: "chave inválida" })), now);
    let jobs = planNotifications(db, t0, settings, ana);
    expect(fail(jobs, t0).finalFailures).toEqual([]);
    expect(planNotifications(db, at("2026-11-02T12:54:00Z"), settings, ana)).toEqual([]);
    jobs = planNotifications(db, at("2026-11-02T12:55:00Z"), settings, ana);
    expect(jobs).toHaveLength(1);
    fail(jobs, at("2026-11-02T12:55:00Z"));
    jobs = planNotifications(db, at("2026-11-02T13:10:00Z"), settings, ana);
    expect(fail(jobs, at("2026-11-02T13:10:00Z")).finalFailures).toEqual([{ title: "Lembrete: X", channel: "whatsapp", error: "chave inválida" }]);
    expect(planNotifications(db, at("2026-11-02T15:00:00Z"), settings, ana)).toEqual([]);
  });

  it("Chrome fechado: lembretes perdidos viram um aviso único; atividade ainda futura avisa normalmente", async () => {
    const { db, actx, ana, settings } = await setup();
    createActivity(db, actx, { title: "Antiga 1", dueAt: "2026-11-02T09:00:00.000Z", reminders: [{ minutesBefore: 15, channels: ["chrome", "whatsapp"] }] });
    createActivity(db, actx, { title: "Antiga 2", dueAt: "2026-11-02T10:00:00.000Z", reminders: [{ minutesBefore: 15, channels: ["chrome"] }] });
    createActivity(db, actx, { title: "Futura", dueAt: "2026-11-02T13:00:00.000Z", reminders: [{ minutesBefore: 240, channels: ["chrome"] }] });
    const jobs = planNotifications(db, at("2026-11-02T12:00:00Z"), settings, ana);
    expect(jobs.map((j) => [j.kind, j.channel, j.title]).sort()).toEqual([
      ["missed", "chrome", "2 atividades começaram enquanto o Chrome estava fechado"],
      ["missed", "whatsapp", "1 atividade começou enquanto o Chrome estava fechado"],
      ["reminder", "chrome", "Lembrete: Futura"],
    ]);
    recordDeliveries(db, ok(jobs), at("2026-11-02T12:00:05Z"));
    expect(planNotifications(db, at("2026-11-02T12:01:00Z"), settings, ana)).toEqual([]);
  });

  it("horário de silêncio segura Chrome e WhatsApp (o e-mail sai); resumo diário uma vez; atrasada avisa uma vez", async () => {
    const { db, actx, ana, settings } = await setup();
    // Datas locais (o resumo e o silêncio seguem o relógio do computador).
    const local = (h: number, m = 0, d = 2) => new Date(2026, 10, d, h, m);
    const s = {
      ...settings,
      [ana]: {
        ...settings[ana],
        quiet: { enabled: true, from: "20:00", to: "07:00" },
        digest: { enabled: true, time: "07:30", channels: ["email" as const, "whatsapp" as const] },
        overdue: { enabled: true, channels: ["chrome" as const] },
      },
    };
    expect(inQuietHours(withDefaults(s[ana]), local(23))).toBe(true);
    expect(inQuietHours(withDefaults(s[ana]), local(7, 5))).toBe(false);
    createActivity(db, actx, { title: "Cedo", dueAt: local(7, 15).toISOString(), reminders: [{ minutesBefore: 60, channels: ["whatsapp", "email"] }] });
    expect(planNotifications(db, local(6, 20), s, ana).map((j) => j.channel)).toEqual(["email"]);
    recordDeliveries(db, ok(planNotifications(db, local(6, 20), s, ana)), local(6, 20));
    expect(planNotifications(db, local(7, 1), s, ana).map((j) => [j.kind, j.channel])).toEqual([["reminder", "whatsapp"]]);
    recordDeliveries(db, ok(planNotifications(db, local(7, 1), s, ana)), local(7, 1));
    createActivity(db, actx, { title: "Proposta", dueAt: local(10).toISOString(), endAt: local(11).toISOString(), reminders: [] });
    const digest = planNotifications(db, local(7, 31), s, ana);
    expect(digest.map((j) => [j.kind, j.channel])).toEqual([
      ["digest", "email"],
      ["digest", "whatsapp"],
    ]);
    expect(digest[0]!.title).toBe("Sua agenda de hoje: 2 atividades");
    expect(digest[1]!.text).toMatch(/Proposta/);
    recordDeliveries(db, ok(digest), local(7, 31));
    expect(planNotifications(db, local(9), s, ana)).toEqual([]);
    const late = planNotifications(db, local(11, 30), s, ana);
    expect(late.map((j) => [j.kind, j.channel, j.title])).toEqual([["overdue", "chrome", "Atividade atrasada: Proposta"]]);
    recordDeliveries(db, ok(late), local(11, 30));
    expect(planNotifications(db, local(12), s, ana)).toEqual([]);
  });

  it("textos: antecedência legível", () => {
    expect([leadLabel(0), leadLabel(15), leadLabel(60), leadLabel(1440), leadLabel(2880)]).toEqual(["na hora", "15 min antes", "1 h antes", "1 dia antes", "2 dias antes"]);
  });
});

describe("canais", () => {
  it("CallMeBot: número com 55, erro de chave e erro de rede", async () => {
    const { callmebotPhone, sendCallMeBot } = await import("../src/lib/notify/callmebot");
    expect(callmebotPhone("(41) 99999-8888")).toBe("+5541999998888");
    expect(callmebotPhone("+55 41 99999-8888")).toBe("+5541999998888");
    const urls: string[] = [];
    const fake = (body: string, status = 200) =>
      (async (u: string) => {
        urls.push(u);
        return new Response(body, { status });
      }) as unknown as typeof fetch;
    await sendCallMeBot("41999998888", " 123 ", "Olá às 9h", fake("Message queued. You will receive it in a few seconds."));
    const q = new URL(urls[0]!).searchParams;
    expect([q.get("phone"), q.get("apikey"), q.get("text")]).toEqual(["+5541999998888", "123", "Olá às 9h"]);
    await expect(sendCallMeBot("41999998888", "x", "t", fake("<p>APIKey is invalid. You need to get a new one</p>"))).rejects.toThrow(/apikey/i);
    await expect(sendCallMeBot("41999998888", "x", "t", fake("Too many requests", 429))).rejects.toThrow(/CallMeBot/);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(sendCallMeBot("41999998888", "x", "t", offline)).rejects.toThrow(/permissão/);
  });

  it("atividade em lote leva os lembretes escolhidos", async () => {
    const { bulkCards } = await import("../src/db/bulkCards");
    const { createCard } = await import("../src/db/deals");
    const { createPipeline } = await import("../src/db/pipelines");
    const { getViewer } = await import("../src/db/users");
    const { db, actx, ana } = await setup();
    const p = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }] });
    const card = createCard(db, actx, { pipelineId: p, title: "A" });
    bulkCards(db, actx, getViewer(db, ana), [card], {
      type: "activity",
      title: "Retomar",
      dueAt: "2026-11-01T12:00:00.000Z",
      reminders: [{ minutesBefore: 60, channels: ["whatsapp"] }],
    });
    const { one } = await import("../src/db/sql");
    const id = one<{ id: string }>(db, "SELECT id FROM activity WHERE deal_id = ?", card)!.id;
    expect(listActivityReminders(db, id)).toEqual([{ minutesBefore: 60, channels: ["whatsapp"] }]);
  });
});
