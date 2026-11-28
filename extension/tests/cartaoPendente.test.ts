// Status "Pendente" do cartão (0.2.160): aguarda a avaliação do usuário para o
// desfecho final, vale para os três tipos de funil e não conta como fechado.
import { describe, expect, it } from "vitest";
import { cardHistory } from "../src/db/cardHistory";
import { createCard, getBoard, getCardRow, setCardStatus } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { buildReport } from "../src/db/reports";
import { one } from "../src/db/sql";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const funil = (type: "comercial" | "operacional" | "projeto") =>
    createPipeline(db, ctx, { name: `Funil ${type}`, type, stages: [{ name: "A" }, { name: "B" }] });
  return { db, ctx, funil };
}

const ids = (cols: { cards: { id: string }[] }[]) => cols.flatMap((c) => c.cards.map((x) => x.id)).sort();

describe("Cartão pendente", () => {
  it("o banco aceita o status pendente (migração 0049) e não marca como fechado", async () => {
    const { db, ctx, funil } = await setup();
    expect(one<{ sql: string }>(db, "SELECT sql FROM sqlite_master WHERE name = 'deal'")!.sql).toContain("'pending'");
    const id = createCard(db, ctx, { pipelineId: funil("comercial"), title: "Escola A", valueCents: 50000 });
    setCardStatus(db, ctx, id, { status: "pending" });
    expect(getCardRow(db, id)).toMatchObject({ status: "pending", closed_at: null, loss_note: null });
    setCardStatus(db, ctx, id, { status: "won" });
    expect(getCardRow(db, id)!.closed_at).not.toBeNull();
  });

  it("vale para os funis comercial, operacional e de projeto", async () => {
    const { db, ctx, funil } = await setup();
    for (const t of ["comercial", "operacional", "projeto"] as const) {
      const id = createCard(db, ctx, { pipelineId: funil(t), title: `Cartão ${t}` });
      setCardStatus(db, ctx, id, { status: "pending" });
      expect(getCardRow(db, id)!.status).toBe("pending");
    }
  });

  it("no quadro: aparece em Abertos e no filtro Pendentes; não em Ganhos", async () => {
    const { db, ctx, funil } = await setup();
    const pid = funil("comercial");
    const aberto = createCard(db, ctx, { pipelineId: pid, title: "Aberto" });
    const pend = createCard(db, ctx, { pipelineId: pid, title: "Pendente" });
    const ganho = createCard(db, ctx, { pipelineId: pid, title: "Ganho" });
    setCardStatus(db, ctx, pend, { status: "pending" });
    setCardStatus(db, ctx, ganho, { status: "won" });
    expect(ids(getBoard(db, pid, { status: "open" }))).toEqual([aberto, pend].sort());
    expect(ids(getBoard(db, pid, { status: "pending" }))).toEqual([pend]);
    expect(ids(getBoard(db, pid, { status: "won" }))).toEqual([ganho]);
  });

  it("histórico e relatórios: 'Marcou como pendente'; conta como aberto, não como ganho/perdido", async () => {
    const { db, ctx, funil } = await setup();
    const pid = funil("comercial");
    const id = createCard(db, ctx, { pipelineId: pid, title: "Escola B", valueCents: 30000 });
    setCardStatus(db, ctx, id, { status: "pending" });
    expect(cardHistory(db, id).some((e) => JSON.stringify(e).includes("Marcou como pendente"))).toBe(true);
    const now = new Date();
    const r = buildReport(db, { from: new Date(now.getTime() - 86_400_000).toISOString(), to: new Date(now.getTime() + 86_400_000).toISOString(), pipelineId: pid });
    expect(r.summary.open.count).toBe(1);
    expect(r.summary.won.count + r.summary.lost.count).toBe(0);
  });
});
