// Campo personalizado disponível só em alguns funis: negócio e atividade
// (atividade vale pelo funil do cartão dela).
import { describe, expect, it } from "vitest";
import { createActivity, updateActivity } from "../src/db/activities";
import { createCustomField, listCustomFields } from "../src/db/customFields";
import { createCard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const power = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const cert = createPipeline(db, ctx, { name: "Certificados", type: "comercial", stages: [{ name: "Prospect" }] });
  const sup = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Aberto" }] });
  return { db, ctx, power, cert, sup };
}

describe("campos personalizados por funil", () => {
  it("negócio: um ou vários funis do mesmo tipo", async () => {
    const { db, ctx, power, cert, sup } = await setup();
    const f = createCustomField(db, ctx, { entity: "deal", name: "Nº de alunos", fieldType: "number", pipelineIds: [power, cert] });
    expect(listCustomFields(db, "deal", { pipelineId: power }).map((x) => x.id)).toContain(f);
    expect(listCustomFields(db, "deal", { pipelineId: cert }).map((x) => x.id)).toContain(f);
    const outro = createPipeline(db, ctx, { name: "EasySchool", type: "comercial", stages: [{ name: "P" }] });
    expect(listCustomFields(db, "deal", { pipelineId: outro }).map((x) => x.id)).not.toContain(f);
    expect(() => createCustomField(db, ctx, { entity: "deal", name: "X", fieldType: "text", pipelineIds: [sup] })).toThrow(/outro tipo/);
    expect(() => createCustomField(db, ctx, { entity: "person", name: "Y", fieldType: "text", pipelineIds: [power] })).toThrow(/negócio, ticket, projeto ou atividade/);
  });

  it("atividade: só nas atividades de cartões dos funis escolhidos (qualquer tipo); obrigatório só lá", async () => {
    const { db, ctx, power, sup } = await setup();
    const f = createCustomField(db, ctx, { entity: "activity", name: "Protocolo do chamado", fieldType: "text", pipelineIds: [sup], required: true });
    const geral = createCustomField(db, ctx, { entity: "activity", name: "Observação", fieldType: "text" });
    const ids = (pipelineId: string | null) => listCustomFields(db, "activity", { pipelineId }).map((x) => x.id);
    expect(ids(sup)).toEqual(expect.arrayContaining([f, geral]));
    expect(ids(power)).toEqual([geral]);
    expect(ids(null)).toEqual([geral]);

    // Atividade sem cartão ou de outro funil: o obrigatório restrito não trava.
    const solta = createActivity(db, ctx, { title: "Ligar", dueAt: "2026-11-20T10:00:00Z" });
    const cPower = createCard(db, ctx, { pipelineId: power, title: "Escola A" });
    expect(() => createActivity(db, ctx, { title: "Visita", dueAt: "2026-11-20T10:00:00Z", dealId: cPower })).not.toThrow();
    // No funil do campo: obrigatório.
    const cSup = createCard(db, ctx, { pipelineId: sup, title: "Chamado 1" });
    expect(() => createActivity(db, ctx, { title: "Atender", dueAt: "2026-11-20T10:00:00Z", dealId: cSup })).toThrow(/Protocolo do chamado/);
    expect(() => createActivity(db, ctx, { title: "Atender", dueAt: "2026-11-20T10:00:00Z", dealId: cSup, customValues: { [f]: "123" } })).not.toThrow();
    expect(() => updateActivity(db, ctx, solta, { customValues: { [geral]: "ok" } })).not.toThrow();
  });
});
