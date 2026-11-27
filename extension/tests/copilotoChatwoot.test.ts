import { describe, expect, it } from "vitest";
import * as cw from "../src/db/chatwoot";
import { createOrganization } from "../src/db/contacts";
import { cardDigest, chatwootTicketsForCopilot } from "../src/db/copilot";
import { createCard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { DATA_TOOLS } from "../src/lib/copilot/tools";
import { freshDb } from "./helpers";

describe("Copiloto: tickets do Chatwoot", () => {
  it("conta cartões com ticket, ativos e cancelados, com filtros", async () => {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Antenor", role: "admin" });
    const ctx = { ...sys, userId: me };
    const power = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Contrato" }] });
    const mg = createPipeline(db, ctx, { name: "Gestão MG", type: "comercial", stages: [{ name: "Ativação" }] });
    const org = createOrganization(db, ctx, { name: "EE Cisipho Campos" });
    const a = createCard(db, ctx, { pipelineId: mg, title: "Cisipho", organizationId: org });
    const b = createCard(db, ctx, { pipelineId: power, title: "Sagrado" });
    createCard(db, ctx, { pipelineId: power, title: "Sem ticket" });
    const data = cw.chatwootContext(db, a).data;
    const link = (n: number) => `https://suporte.powercubus.com.br/app/accounts/1/conversations/${n}`;
    cw.recordChatwootTicket(db, ctx, a, { conversationId: 2407, link: link(2407), data });
    cw.recordChatwootTicket(db, ctx, b, { conversationId: 2408, link: link(2408), data });
    cw.recordChatwootTicket(db, ctx, b, { conversationId: 2409, link: link(2409), data });
    cw.recordChatwootCancel(db, ctx, b, { conversationId: 2409, note: "duplicado" });

    const viewer = { id: me, role: "admin" as const };
    const r = chatwootTicketsForCopilot(db, viewer, {});
    expect(r).toMatchObject({ cartoesComTicket: 2, tickets: 2, ativos: 2, cancelados: 0, cartoesPorFunil: { "Gestão MG": 1, PowerCubus: 1 } });
    expect(chatwootTicketsForCopilot(db, viewer, { situacao: "todos" })).toMatchObject({ cartoesComTicket: 2, tickets: 3, cancelados: 1 });
    expect(chatwootTicketsForCopilot(db, viewer, { situacao: "cancelados" })).toMatchObject({ tickets: 1, lista: [{ conversa: 2409, motivoCancelamento: "duplicado" }] });
    expect(chatwootTicketsForCopilot(db, viewer, { funil: "mg" })).toMatchObject({ cartoesComTicket: 1, lista: [{ cartao: "Cisipho", organizacao: "EE Cisipho Campos", abertoPor: "Antenor" }] });
    expect(chatwootTicketsForCopilot(db, viewer, { texto: "cisipho" })).toMatchObject({ tickets: 1 });
    expect(chatwootTicketsForCopilot(db, viewer, { de: "2000-01-01", ate: "2000-01-02" })).toMatchObject({ tickets: 0 });
    expect(cardDigest(db, viewer, a)).toMatchObject({ ticketsChatwoot: [{ conversa: 2407 }] });
    expect(DATA_TOOLS.some((t) => t.name === "tickets_chatwoot")).toBe(true);
  });
});
