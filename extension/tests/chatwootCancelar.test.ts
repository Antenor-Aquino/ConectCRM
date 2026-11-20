// Cancelar ticket do Chatwoot pelo cartão: situação real das conversas,
// cancelamento (nota → devolver ao dono do token → resolver) e regra do aviso.
import { describe, expect, it } from "vitest";
import { activeTickets, CHATWOOT_DEFAULTS, ChatwootError, cancelTicket, ticketStates } from "../src/lib/chatwoot";
import * as cw from "../src/db/chatwoot";
import { createCard } from "../src/db/deals";
import { listNotes } from "../src/db/notes";
import { createPerson } from "../src/db/contacts";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

const s = { ...CHATWOOT_DEFAULTS, token: "tok" };

/** Chatwoot simulado: conversas por id ({status} ou 404). */
function mock(convs: Record<number, string | 404>, o: { failAt?: string } = {}) {
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  const fn = (async (url: string, opts: RequestInit = {}) => {
    const method = opts.method ?? "GET";
    const path = url.includes("/accounts/1") ? url.split("/accounts/1")[1]! : url.replace(/^.*\/api\/v1/, "");
    calls.push(`${method} ${path}`);
    if (opts.body) bodies[`${method} ${path}`] = JSON.parse(String(opts.body));
    const res = (status: number, b: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(b), json: async () => b }) as unknown as Response;
    if (o.failAt && path.endsWith(o.failAt)) return res(500, { error: "falhou" });
    if (path === "/profile") return res(200, { id: 42, name: "Antenor Aquino" });
    const m = path.match(/^\/conversations\/(\d+)$/);
    if (m && method === "GET") {
      const st = convs[Number(m[1])];
      return st === 404 || st === undefined ? res(404, { error: "not found" }) : res(200, { status: st, meta: { assignee: { name: "Mauricio Vieira" } } });
    }
    return res(200, {});
  }) as unknown as typeof fetch;
  return { fn, calls, bodies };
}

describe("situação das conversas", () => {
  it("lê status e responsável; 404 = apagada; falha = não consultada", async () => {
    const m = mock({ 2316: "open", 2315: "resolved", 10: 404 });
    const r = await ticketStates(s, [2316, 2315, 10], m.fn);
    expect(r.map((x) => [x.id, x.status, x.cancelable, x.assignee])).toEqual([
      [2316, "open", true, "Mauricio Vieira"],
      [2315, "resolved", false, "Mauricio Vieira"],
      [10, "deleted", false, null],
    ]);
    const broken = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect((await ticketStates(s, [5], broken))[0]).toMatchObject({ status: "unknown", cancelable: false });
  });

  it("aviso só com ticket em andamento: 0, 1 e vários (abertos/resolvidos/apagados)", () => {
    const t = (id: number, canceled: string | null = null) => ({ conversation_id: id, canceled_at: canceled });
    const st = (id: number, status: "open" | "pending" | "snoozed" | "resolved" | "deleted" | "unknown") => ({ id, status, cancelable: false, assignee: null, link: "" });
    expect(activeTickets([], [])).toEqual([]);
    expect(activeTickets([t(1)], [st(1, "open")])).toHaveLength(1);
    expect(activeTickets([t(1)], [st(1, "resolved")])).toHaveLength(0);
    expect(activeTickets([t(1), t(2), t(3), t(4)], [st(1, "resolved"), st(2, "deleted"), st(3, "pending"), st(4, "snoozed")]).map((x) => x.conversation_id)).toEqual([3, 4]);
    // Sem consulta ao Chatwoot: vale o registro do CRM.
    expect(activeTickets([t(1), t(2, "2026-11-19")], null).map((x) => x.conversation_id)).toEqual([1]);
    expect(activeTickets([t(1)], [st(1, "unknown")])).toHaveLength(1);
  });
});

describe("cancelar ticket", () => {
  it("observação vazia: nada é enviado ao Chatwoot", async () => {
    const m = mock({ 2316: "open" });
    await expect(cancelTicket(s, 2316, "  ok ", m.fn)).rejects.toThrow(/observação/);
    expect(m.calls).toEqual([]);
  });

  it("já resolvida: recusa sem mexer", async () => {
    const m = mock({ 2315: "resolved" });
    await expect(cancelTicket(s, 2315, "Cliente desistiu", m.fn)).rejects.toThrow(/já está resolvida/);
    expect(m.calls).toEqual(["GET /conversations/2315"]);
  });

  it("ordem: conversa → perfil → nota privada → devolve ao dono do token → resolve", async () => {
    const m = mock({ 2316: "open" });
    const r = await cancelTicket(s, 2316, "Cliente desistiu da compra", m.fn);
    expect(m.calls).toEqual([
      "GET /conversations/2316",
      "GET /profile",
      "POST /conversations/2316/messages",
      "POST /conversations/2316/assignments",
      "POST /conversations/2316/toggle_status",
    ]);
    const note = m.bodies["POST /conversations/2316/messages"] as { content: string; private: boolean };
    expect(note.private).toBe(true);
    expect(note.content).toMatch(/^\*\*Ticket cancelado\*\*\n\nObservação: Cliente desistiu da compra\nCancelado por: Antenor Aquino em /);
    expect(m.bodies["POST /conversations/2316/assignments"]).toEqual({ assignee_id: 42 });
    expect(m.bodies["POST /conversations/2316/toggle_status"]).toEqual({ status: "resolved" });
    expect(r).toMatchObject({ conversationId: 2316, assigneeId: 42, user: "Antenor Aquino", link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2316" });
  });

  it("falha no meio: diz o que já foi feito e traz o link", async () => {
    const m = mock({ 2316: "open" }, { failAt: "/toggle_status" });
    const e = (await cancelTicket(s, 2316, "Cliente desistiu", m.fn).catch((x) => x)) as ChatwootError;
    expect(e.message).toMatch(/já feito: nota gravada, devolvida ao seu usuário/);
    expect(e.link).toMatch(/conversations\/2316$/);
  });
});

describe("registro no cartão", () => {
  it("marca o ticket como cancelado e deixa nota com a observação", async () => {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Antenor", role: "admin" });
    const ctx = { ...sys, userId: me };
    const pl = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "P" }] });
    const p = createPerson(db, ctx, { name: "Rozi", email: "r@x.com" });
    const card = createCard(db, ctx, { pipelineId: pl, title: "Licenças", personId: p });
    const data = cw.chatwootContext(db, card).data;
    cw.recordChatwootTicket(db, ctx, card, { conversationId: 2316, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2316", data });
    expect(() => cw.recordChatwootCancel(db, ctx, card, { conversationId: 2316, note: "ok" })).toThrow(/observação/);
    expect(() => cw.recordChatwootCancel(db, ctx, card, { conversationId: 999, note: "Cliente desistiu" })).toThrow(/não está registrado/);
    cw.recordChatwootCancel(db, ctx, card, { conversationId: 2316, note: "Cliente desistiu", by: "Antenor Aquino" });
    expect(cw.listChatwootTickets(db, card)[0]).toMatchObject({ conversation_id: 2316, cancel_note: "Cliente desistiu" });
    expect(cw.listChatwootTickets(db, card)[0]!.canceled_at).toBeTruthy();
    expect(listNotes(db, "deal", card)[0]!.body).toBe(
      "Ticket do Chatwoot cancelado (conversa 2316, resolvida e devolvida a Antenor Aquino):\nhttps://suporte.powercubus.com.br/app/accounts/1/conversations/2316\n\nObservação: Cliente desistiu",
    );
  });
});
