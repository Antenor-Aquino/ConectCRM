// Avisos da Gestão Financeira só com a integração ativada pelo usuário.
import { describe, expect, it } from "vitest";
import { gfIntegrationActive, DEFAULT_GF_SETTINGS } from "../src/lib/finance/gfBridge";
import { buildSystemPrompt, FINANCE_TOOLS } from "../src/lib/copilot/agent";

describe("integração com a Gestão Financeira ativada", () => {
  it("ativa = conectada no modo direto, ou modo pacote ligado", () => {
    expect(gfIntegrationActive(DEFAULT_GF_SETTINGS)).toBe(false);
    expect(gfIntegrationActive({ ...DEFAULT_GF_SETTINGS, gfId: "x" })).toBe(true);
    expect(gfIntegrationActive({ ...DEFAULT_GF_SETTINGS, gfId: "x", direct: false })).toBe(false);
    expect(gfIntegrationActive({ ...DEFAULT_GF_SETTINGS, package: true })).toBe(true);
    expect(gfIntegrationActive(null)).toBe(false);
  });

  it("Copiloto só fala de financeiro com a integração ativada", () => {
    const base = { userName: "Antenor", userRole: "administrador" };
    const off = buildSystemPrompt(base);
    for (const t of FINANCE_TOOLS) expect(off).not.toContain(t);
    expect(off).not.toContain("Gestão Financeira");
    const on = buildSystemPrompt({ ...base, finance: true });
    for (const t of FINANCE_TOOLS) expect(on).toContain(t);
  });
});

describe("resumo diário", async () => {
  const { freshDb } = await import("./helpers");
  const { createOrganization } = await import("../src/db/contacts");
  const { createCard, setCardStatus } = await import("../src/db/deals");
  const { createPipeline } = await import("../src/db/pipelines");
  const { createUser } = await import("../src/db/users");
  const { replaceAllFinance } = await import("../src/db/finance");
  const { planNotifications } = await import("../src/db/notifications");

  it("o bloco Financeiro só entra com a integração ativada", async () => {
    const { db, ctx } = await freshDb();
    const ana = createUser(db, ctx, { name: "Ana", role: "admin" });
    const actx = { ...ctx, userId: ana };
    const pl = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "Proposta" }] });
    const stage = db.exec(`SELECT id FROM stage WHERE pipeline_id = '${pl}'`)[0]!.values[0]![0] as string;
    const card = createCard(db, actx, { pipelineId: pl, stageId: stage, title: "Licença", organizationId: createOrganization(db, actx, { name: "Escola" }), valueCents: 90000 });
    setCardStatus(db, actx, card, { status: "won" });
    db.exec(`UPDATE deal SET closed_at = '2026-10-01T12:00:00.000Z'`);
    replaceAllFinance(db, actx, [], "production", "2026-10-20T08:00:00.000Z"); // a integração já foi usada
    const settings = { [ana]: { digest: { enabled: true, time: "07:30", channels: ["chrome" as const] } } };
    const at = new Date(2026, 9, 20, 8, 0);
    const off = planNotifications(db, at, settings, ana);
    expect(off).toHaveLength(1);
    expect(off[0]!.text).not.toMatch(/Financeiro/);
    const on = planNotifications(db, at, settings, ana, true);
    expect(on[0]!.text).toMatch(/Financeiro:[\s\S]*Licença: falta R\$\s900,00/);
  });
});
