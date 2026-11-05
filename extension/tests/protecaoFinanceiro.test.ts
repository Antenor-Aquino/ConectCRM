// Cartão com lançamento na Gestão Financeira não se perde (spec 13): não é
// excluído (nem apagado da lixeira), só arquivado.
import { describe, expect, it } from "vitest";
import { bulkCards } from "../src/db/bulkCards";
import { createCard, deleteCard, getCard } from "../src/db/deals";
import { cardFinance, replaceFinance } from "../src/db/finance";
import { cardFinanceLock, financeBlockMessage } from "../src/db/financeLock";
import { createPipeline } from "../src/db/pipelines";
import { setCardArchived } from "../src/db/bulkCards";
import { listTrash, purgeTrash } from "../src/db/trash";
import { createUser } from "../src/db/users";
import { classifyDelete } from "../src/lib/finance/deleteGuard";
import type { FinanceItem } from "../src/lib/finance/protocol";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx } = await freshDb();
  const actx = { ...ctx, userId: createUser(db, ctx, { name: "Antenor", role: "admin" }) };
  const pl = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "Proposta" }] });
  const stage = db.exec(`SELECT id FROM stage WHERE pipeline_id = '${pl}'`)[0]!.values[0]![0] as string;
  const card = (title: string) => createCard(db, actx, { pipelineId: pl, stageId: stage, title });
  const entry = (ref: string, id = "e1", type: "income" | "expense" = "income"): FinanceItem => ({
    id, ref, type, amountCents: 30000, code: null, status: "pending", description: "x", competenceDate: "2026-10-01", dueDate: "2026-10-10",
    paymentDate: null, category: null, subcategory: null, costCenter: null, costSubcenter: null, counterparty: null, wallet: "Empresa",
    account: null, creditCard: null, installmentNumber: null, installmentTotal: null,
  });
  const lancar = (dealId: string, items: FinanceItem[]) => replaceFinance(db, actx, [dealId], items, "production", new Date().toISOString());
  const pedido = (dealId: string, status: string) =>
    db.exec(
      `INSERT INTO finance_request (id, workspace_id, deal_id, payload, status, created_at) VALUES ('r-${status}-${dealId}', '${actx.workspaceId}', '${dealId}', '{}', '${status}', '2026-10-01T00:00:00Z')`,
    );
  return { db, actx, card, entry, lancar, pedido };
}

describe("cartão com financeiro", () => {
  it("não pode ser excluído, mas pode ser arquivado e continua no banco", async () => {
    const { db, actx, card, entry, lancar } = await setup();
    const id = card("Agência Brasil Central");
    lancar(id, [entry(id), entry(id, "e2", "expense")]);

    expect(() => deleteCard(db, actx, id)).toThrow(/2 lançamentos na Gestão Financeira e não pode ser excluído/);
    expect(getCard(db, id)).toBeTruthy();

    setCardArchived(db, actx, id, true);
    const arquivado = getCard(db, id);
    expect(arquivado?.archived_at).toBeTruthy();
    expect(cardFinance(db, id).entries).toHaveLength(2);
    expect(listTrash(db, null)).toHaveLength(0);
  });

  it("depois de os lançamentos serem excluídos na Gestão Financeira, a exclusão é liberada", async () => {
    const { db, actx, card, entry, lancar } = await setup();
    const id = card("Cliente");
    lancar(id, [entry(id)]);
    expect(() => deleteCard(db, actx, id)).toThrow();
    lancar(id, []); // nova leitura: nada mais lá
    const aviso = deleteCard(db, actx, id);
    expect(aviso.ids.length).toBeGreaterThan(0);
    expect(getCard(db, id)).toBeUndefined();
  });

  it("pedido do pacote (pendente ou exportado) trava; descartado ou já lançado não", async () => {
    const { db, actx, card, pedido } = await setup();
    const a = card("A");
    pedido(a, "pending");
    expect(cardFinanceLock(db, a)).toMatchObject({ entries: 0, requests: 1 });
    expect(() => deleteCard(db, actx, a)).toThrow(/1 pedido de lançamento/);

    const b = card("B");
    pedido(b, "exported");
    expect(() => deleteCard(db, actx, b)).toThrow();

    // "launched" já aparece como lançamento na cópia; sozinho não pode travar para sempre.
    const c = card("C");
    pedido(c, "launched");
    expect(cardFinanceLock(db, c).requests).toBe(0);
    deleteCard(db, actx, c);

    db.exec("UPDATE finance_request SET deleted_at = '2026-10-02T00:00:00Z' WHERE deal_id = '" + a + "'");
    deleteCard(db, actx, a);
  });

  it("exclusão em lote: pula o que tem financeiro e relata o motivo", async () => {
    const { db, actx, card, entry, lancar } = await setup();
    const livre = card("Livre");
    const preso = card("Preso");
    lancar(preso, [entry(preso)]);
    const r = bulkCards(db, actx, null, [livre, preso], { type: "delete" });
    expect(r.done).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ id: preso, title: "Preso" });
    expect(r.errors[0]!.message).toMatch(/não pode ser excluído/);
    expect(getCard(db, preso)).toBeTruthy();
    expect(getCard(db, livre)).toBeUndefined();
  });

  it("arquivar em lote funciona para o cartão com financeiro", async () => {
    const { db, actx, card, entry, lancar } = await setup();
    const id = card("Preso");
    lancar(id, [entry(id)]);
    const r = bulkCards(db, actx, null, [id], { type: "archive" });
    expect(r).toMatchObject({ done: 1, errors: [] });
    expect(getCard(db, id)?.archived_at).toBeTruthy();
  });

  it("a lixeira não apaga de vez o cartão que ganhou financeiro (ou já tinha, de antes da regra)", async () => {
    const { db, actx, card, entry, lancar } = await setup();
    const id = card("Antigo");
    deleteCard(db, actx, id); // excluído antes de ter lançamento
    lancar(id, [entry(id)]); // o lançamento aparece depois (ex.: criado na Gestão Financeira)
    const [item] = listTrash(db, null);
    expect(item).toMatchObject({ entity: "deal", record_id: id, finance_locked: true });

    const r = purgeTrash(db, actx, [item!.id], () => []);
    expect(r).toMatchObject({ purged: 0, protected: 1 });
    expect(listTrash(db, null)).toHaveLength(1);
    expect(db.exec(`SELECT COUNT(*) FROM deal WHERE id = '${id}'`)[0]!.values[0]![0]).toBe(1);

    // Sem lançamentos, a limpeza segue normal.
    lancar(id, []);
    expect(purgeTrash(db, actx, [item!.id], () => [])).toMatchObject({ purged: 1, protected: 0 });
    expect(db.exec(`SELECT COUNT(*) FROM deal WHERE id = '${id}'`)[0]!.values[0]![0]).toBe(0);
  });

  it("mensagem no singular e no plural", () => {
    const lock = { entries: 1, requests: 0, incomeCents: 0, expenseCents: 0, synced: true };
    expect(financeBlockMessage(lock)).toMatch(/1 lançamento na Gestão Financeira e não pode/);
    expect(financeBlockMessage({ ...lock, entries: 3, requests: 2 }, "ticket")).toMatch(/Este ticket tem 3 lançamentos na Gestão Financeira e 2 pedidos/);
  });
});

describe("conferência antes de excluir (tela)", () => {
  const lock = (p: Partial<{ entries: number; requests: number; synced: boolean }> = {}) => ({
    entries: 0, requests: 0, incomeCents: 0, expenseCents: 0, synced: false, ...p,
  });

  it("modo direto, Gestão Financeira fora do ar e cartão nunca lido: bloqueia por não confirmado", () => {
    const r = classifyDelete(["a", "b"], { a: lock(), b: lock({ synced: true }) }, true, false, "sem resposta");
    expect(r.blocked).toEqual([{ id: "a", reason: "unverified", lock: lock() }]);
    expect(r.free).toEqual(["b"]);
    expect(r.offlineReason).toBe("sem resposta");
  });

  it("modo direto com leitura ao vivo feita: libera quem não tem lançamento", () => {
    const r = classifyDelete(["a"], { a: lock({ synced: true }) }, true, true);
    expect(r).toMatchObject({ free: ["a"], blocked: [] });
  });

  it("modo pacote (ou integração nunca ligada): só o que o banco sabe; não bloqueia à toa", () => {
    expect(classifyDelete(["a"], { a: lock() }, false, false).free).toEqual(["a"]);
    expect(classifyDelete(["a"], { a: lock({ requests: 1 }) }, false, false).blocked[0]).toMatchObject({ id: "a", reason: "finance" });
  });

  it("lançamento conhecido bloqueia mesmo com a Gestão Financeira fora do ar", () => {
    const r = classifyDelete(["a"], { a: lock({ entries: 2, synced: true }) }, true, false);
    expect(r.blocked[0]).toMatchObject({ reason: "finance" });
  });
});
