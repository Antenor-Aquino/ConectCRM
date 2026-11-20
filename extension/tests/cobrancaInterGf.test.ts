// Baixa da receita na Gestão Financeira com novas tentativas (boleto pago antes
// de a receita ser salva lá, ou com a GF fechada).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrganization } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import * as ch from "../src/db/charges";
import { listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

const gf = vi.hoisted(() => ({
  settings: { gfId: "gf", direct: true } as { gfId: string | null; direct: boolean },
  settle: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../src/lib/finance/gfBridge", () => ({
  loadGfSettings: async () => gf.settings,
  settleLaunch: gf.settle,
  removeLaunch: gf.remove,
}));
import { syncGfPending } from "../src/lib/interSync";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pc = createPipeline(db, ctx, { name: "Certificados", type: "comercial", stages: [{ name: "Prospecção" }] });
  const org = createOrganization(db, ctx, { name: "Claudia Tecnologia" });
  const card = createCard(db, ctx, { pipelineId: pc, title: "Claudia Teste", organizationId: org, valueCents: 300 });
  const id = ch.saveInterCharge(db, ctx, card, {
    env: "sandbox",
    seuNumero: "C2611151200",
    codigoSolicitacao: "k1",
    situacao: "A_RECEBER",
    items: [{ description: "Certificado", quantity: 1, priceCents: 300 }],
    description: "Boleto Inter — Claudia Teste",
    dueDate: "2026-11-15",
  });
  // RPC "de mentira" falando direto com o banco (como o offscreen faria).
  const rpc = async <T,>(m: string, p: Record<string, unknown>): Promise<T> => {
    if (m === "charges.gfPending") return ch.gfPendingCharges(db, p.cardId as string | undefined) as T;
    if (m === "charges.gfSyncResult") return ch.gfSyncResult(db, ctx, p.id as string, p as { done: boolean; error?: string }) as T;
    throw new Error(m);
  };
  return { db, ctx, card, id, rpc };
}

beforeEach(() => {
  gf.settings = { gfId: "gf", direct: true };
  gf.settle.mockReset();
  gf.remove.mockReset();
});

describe("boleto pago → baixa na Gestão Financeira com novas tentativas", () => {
  it("pago antes de a receita existir na GF: fica pendente e dá baixa quando ela aparece", async () => {
    const { db, ctx, card, id, rpc } = await setup();
    ch.applyInterSituacao(db, ctx, id, { situacao: "RECEBIDO", dataSituacao: "2026-11-15" });
    expect(ch.gfPendingCharges(db).map((c) => c.id)).toEqual([id]);

    gf.settle.mockResolvedValueOnce({ updated: 0, total: 0 });
    const r1 = await syncGfPending(rpc, { cardId: card });
    expect(r1[0]).toMatchObject({ done: false });
    expect(r1[0]!.message).toMatch(/não está na Gestão Financeira/);
    expect(gf.settle).toHaveBeenCalledWith("gf", card, "C2611151200", true, "2026-11-15");
    expect(ch.listCharges(db, card)[0]!.gf_sync).toBe("paid");

    gf.settle.mockResolvedValueOnce({ updated: 1, total: 1 });
    const r2 = await syncGfPending(rpc);
    expect(r2[0]).toMatchObject({ done: true, message: "Receita marcada como Recebida na Gestão Financeira." });
    expect(ch.gfPendingCharges(db)).toEqual([]);
    expect(ch.listCharges(db, card)[0]!.gf_sync).toBeNull();
  });

  it("GF fechada (erro): continua pendente com o motivo; desiste em 7 dias com nota no cartão", async () => {
    const { db, ctx, card, id, rpc } = await setup();
    ch.applyInterSituacao(db, ctx, id, { situacao: "RECEBIDO" });
    gf.settle.mockRejectedValue(new Error("A Gestão Financeira não respondeu."));
    await syncGfPending(rpc);
    expect(ch.listCharges(db, card)[0]!.gf_sync_error).toMatch(/não respondeu/);
    ch.gfSyncResult(db, ctx, id, { done: false, error: "sem resposta" }, new Date(Date.now() + 8 * 86400_000));
    expect(ch.gfPendingCharges(db)).toEqual([]);
    expect(listNotes(db, "deal", card)[0]!.body).toMatch(/Não consegui dar baixa na receita .* em 7 dias/);
  });

  it("cancelado/expirado: exclui a receita; sem a GF conectada não há o que fazer", async () => {
    const { db, ctx, id, rpc } = await setup();
    ch.applyInterSituacao(db, ctx, id, { situacao: "EXPIRADO" });
    gf.remove.mockResolvedValueOnce({ removed: 1, pending: 1, paid: 0 });
    expect((await syncGfPending(rpc))[0]).toMatchObject({ done: true, message: "Receita excluída da Gestão Financeira." });

    const s2 = await setup();
    ch.applyInterSituacao(s2.db, s2.ctx, s2.id, { situacao: "RECEBIDO" });
    gf.settings = { gfId: null, direct: false };
    expect((await syncGfPending(s2.rpc))[0]).toMatchObject({ done: true });
    expect(gf.settle).not.toHaveBeenCalled();
  });
});
