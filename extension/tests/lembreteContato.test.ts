// Lembrete para o contato por WhatsApp: modelo (variáveis, sem link, sem
// empresa), regras de agendamento/edição, envio, cancelamento, hora perdida,
// empresa do funil e recorrentes.
import { describe, expect, it } from "vitest";
import { createActivity, setActivityDone, updateActivity } from "../src/db/activities";
import * as series from "../src/db/activitySeries";
import { createPerson } from "../src/db/contacts";
import * as cm from "../src/db/contactMessages";
import { createCard } from "../src/db/deals";
import { listNotes } from "../src/db/notes";
import { createPipeline, updatePipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { CONTACT_TEMPLATE_DEFAULT, renderContactMessage, whenText } from "../src/lib/notify/contactMessage";
import { freshDb } from "./helpers";

const base = { personName: "Maria José da Silva", start: new Date("2026-10-22T10:00:00"), activityTitle: "Apresentação", myName: "Antenor" };

describe("modelo da mensagem", () => {
  it("preenche as variáveis e assina com a empresa", () => {
    const t = renderContactMessage(CONTACT_TEMPLATE_DEFAULT, { ...base, link: "https://meet.google.com/abc", company: "AEB Sistemas" }, new Date("2026-10-22T09:00:00"));
    expect(t).toBe(
      "Olá, Maria! 👋\nPassando para lembrar da nossa conversa hoje às 10:00.\n🔗 https://meet.google.com/abc\nSe surgir algum imprevisto, é só me avisar por aqui. Até já!\nAntenor · AEB Sistemas",
    );
  });

  it("sem link some a linha; sem empresa some a empresa e o que a liga ao nome", () => {
    const t = renderContactMessage(CONTACT_TEMPLATE_DEFAULT, { ...base, link: null, company: null }, new Date("2026-10-21T18:00:00"));
    expect(t).not.toContain("🔗");
    expect(t).toContain("amanhã às 10:00");
    expect(t.endsWith("\nAntenor")).toBe(true);
    expect(renderContactMessage("Aqui é {meu_nome} da {minha_empresa}.", { ...base, link: null, company: "" })).toBe("Aqui é Antenor.");
    expect(renderContactMessage("Aqui é {meu_nome} da {minha_empresa}.", { ...base, link: null, company: "AEB" })).toBe("Aqui é Antenor da AEB.");
  });

  it("quando: hoje, amanhã ou o dia da semana", () => {
    const now = new Date("2026-10-22T08:00:00"); // quinta
    expect(whenText(new Date("2026-10-22T15:00:00"), now)).toBe("hoje");
    expect(whenText(new Date("2026-10-23T15:00:00"), now)).toBe("amanhã");
    expect(whenText(new Date("2026-10-27T15:00:00"), now)).toBe("na terça, 27/10");
  });
});

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const maria = createPerson(db, ctx, { name: "Maria José", phone: "+5511987654321" });
  const semCel = createPerson(db, ctx, { name: "Pedro" });
  const pl = createPipeline(db, ctx, { name: "Vendas AEB", type: "comercial", stages: [{ name: "Proposta" }] });
  updatePipeline(db, ctx, pl, { companyName: "AEB Sistemas" });
  const deal = createCard(db, ctx, { pipelineId: pl, title: "Licenças 2027", personId: maria });
  return { db, ctx, me, maria, semCel, deal };
}
const msg = (personId: string, extra: Partial<cm.ContactMessageInput> = {}): cm.ContactMessageInput => ({
  personId,
  minutesBefore: 60,
  template: CONTACT_TEMPLATE_DEFAULT,
  senderId: "zapi-1",
  ...extra,
});

describe("lembrete do contato no banco", () => {
  it("só com celular; destinatários do cartão; empresa do funil", async () => {
    const { db, ctx, maria, semCel, deal } = await setup();
    const a = createActivity(db, ctx, { title: "Reunião", dueAt: "2026-10-22T10:00:00", dealId: deal });
    expect(() => cm.setContactMessage(db, ctx, a, msg(semCel))).toThrow(/não tem celular/);
    expect(cm.contactRecipients(db, { dealId: deal }).map((r) => r.name)).toEqual(["Maria José"]);
    expect(cm.companyForDeal(db, deal)).toBe("AEB Sistemas");
    cm.setContactMessage(db, ctx, a, msg(maria));
    expect(cm.contactMessagePreview(db, a)!.preview).toContain("Antenor · AEB Sistemas");
  });

  it("sai na hora certa, vira nota e não muda mais depois de enviado", async () => {
    const { db, ctx, maria, deal } = await setup();
    const a = createActivity(db, ctx, { title: "Reunião", dueAt: "2026-10-22T10:00:00", dealId: deal, meetingUrl: "meet.google.com/abc-defg-hij" });
    cm.setContactMessage(db, ctx, a, msg(maria));
    expect(cm.dueContactMessages(db, ctx, new Date("2026-10-22T08:59:00")).jobs).toHaveLength(0);
    const { jobs } = cm.dueContactMessages(db, ctx, new Date("2026-10-22T09:00:00"));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!).toMatchObject({ phone: "+5511987654321", senderId: "zapi-1" });
    expect(jobs[0]!.text).toContain("https://meet.google.com/abc-defg-hij");
    cm.recordContactMessage(db, ctx, jobs[0]!.id, { ok: true, text: jobs[0]!.text });
    expect(cm.getContactMessage(db, a)!.status).toBe("sent");
    expect(listNotes(db, "activity", a)[0]!.body).toContain("Lembrete enviado por WhatsApp para Maria José");
    expect(listNotes(db, "person", maria)).toHaveLength(1);
    expect(() => cm.setContactMessage(db, ctx, a, msg(maria, { minutesBefore: 30 }))).toThrow(/já foi enviado/);
    expect(cm.dueContactMessages(db, ctx, new Date("2026-10-22T09:30:00")).jobs).toHaveLength(0);
  });

  it("editável até o envio; mudar a data muda o envio; desligar tira", async () => {
    const { db, ctx, maria } = await setup();
    const a = createActivity(db, ctx, { title: "Call", dueAt: "2026-10-22T10:00:00", personId: maria });
    cm.setContactMessage(db, ctx, a, msg(maria));
    cm.setContactMessage(db, ctx, a, msg(maria, { minutesBefore: 30, template: "Oi {nome}, até {hora}!" }));
    updateActivity(db, ctx, a, { dueAt: "2026-10-22T15:00:00" });
    expect(cm.dueContactMessages(db, ctx, new Date("2026-10-22T14:29:00")).jobs).toHaveLength(0);
    expect(cm.dueContactMessages(db, ctx, new Date("2026-10-22T14:30:00")).jobs[0]!.text).toBe("Oi Maria, até 15:00!");
    cm.setContactMessage(db, ctx, a, null);
    expect(cm.getContactMessage(db, a)).toBeUndefined();
  });

  it("Chrome fechado: sai atrasado se a atividade não começou; senão fica não enviada", async () => {
    const { db, ctx, maria } = await setup();
    const a = createActivity(db, ctx, { title: "Call", dueAt: "2026-10-22T10:00:00", personId: maria });
    const b = createActivity(db, ctx, { title: "Visita", dueAt: "2026-10-22T11:00:00", personId: maria });
    cm.setContactMessage(db, ctx, a, msg(maria));
    cm.setContactMessage(db, ctx, b, msg(maria));
    const r = cm.dueContactMessages(db, ctx, new Date("2026-10-22T10:30:00"));
    expect(r.jobs.map((j) => j.activityId)).toEqual([b]);
    expect(r.missed.map((m) => m.title)).toEqual(["Call"]);
    expect(cm.getContactMessage(db, a)!.status).toBe("skipped");
    // salvar de novo reagenda
    updateActivity(db, ctx, a, { dueAt: "2026-10-22T16:00:00" });
    cm.setContactMessage(db, ctx, a, msg(maria));
    expect(cm.getContactMessage(db, a)!.status).toBe("pending");
  });

  it("atividade concluída antes cancela", async () => {
    const { db, ctx, maria } = await setup();
    const a = createActivity(db, ctx, { title: "Call", dueAt: "2026-10-22T10:00:00", personId: maria });
    cm.setContactMessage(db, ctx, a, msg(maria));
    setActivityDone(db, ctx, a, true);
    expect(cm.dueContactMessages(db, ctx, new Date("2026-10-22T09:30:00")).jobs).toHaveLength(0);
    expect(cm.getContactMessage(db, a)!.status).toBe("canceled");
  });

  it("recorrente: cada ocorrência leva o seu lembrete", async () => {
    const { db, ctx, maria } = await setup();
    const { seriesId } = series.createSeries(
      db,
      ctx,
      { title: "Acompanhamento", dueAt: "2026-10-22T10:00:00", personId: maria, recurrence: { freq: "weekly", interval: 1, end: { type: "count", count: 3 } }, contactMessage: msg(maria) },
      new Date("2026-10-22T08:00:00"),
    );
    const ids = db.exec(`SELECT id FROM activity WHERE series_id = '${seriesId}'`)[0]!.values.map((v) => String(v[0]));
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => cm.getContactMessage(db, id)?.status === "pending")).toBe(true);
  });
});
