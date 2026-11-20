// Anexos do cartão no Chatwoot: nota privada multipart com os arquivos, ao abrir
// o ticket e depois, numa conversa em andamento.
import { describe, expect, it } from "vitest";
import { attachmentsNote, CHATWOOT_DEFAULTS, ChatwootError, openActivationTicket, sendPrivateFiles } from "../src/lib/chatwoot";
import * as cw from "../src/db/chatwoot";
import { createPerson } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import { listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

const s = { ...CHATWOOT_DEFAULTS, token: "tok" };
const file = (name: string, size = 10) => ({ blob: new Blob(["x".repeat(size)], { type: "application/pdf" }), filename: name });

function mock(o: { status?: number } = {}) {
  const sent: { path: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = (async (url: string, opts: RequestInit = {}) => {
    const path = url.split("/accounts/1")[1] ?? url;
    sent.push({ path, body: opts.body, headers: (opts.headers ?? {}) as Record<string, string> });
    const ok = (b: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) }) as Response;
    if (path.startsWith("/contacts/search")) return ok({ payload: [{ id: 9, email: "c@x.com" }] });
    if (path === "/conversations") return ok({ id: 555 });
    if (o.status && opts.body instanceof FormData) return { ok: false, status: o.status, text: async () => "too large" } as Response;
    return ok({});
  }) as unknown as typeof fetch;
  return { fn, sent };
}

describe("anexos no Chatwoot", () => {
  it("nota privada multipart com os arquivos (sem Content-Type manual)", async () => {
    const m = mock();
    await sendPrivateFiles(s, 2316, attachmentsNote(["Contrato assinado.pdf", "Convocação.pdf"], "Assinado pela diretora"), [file("Contrato assinado.pdf"), file("Convocação.pdf")], m.fn);
    const call = m.sent[0]!;
    expect(call.path).toBe("/conversations/2316/messages");
    expect(call.headers).toEqual({ api_access_token: "tok" });
    const form = call.body as FormData;
    expect(form.get("private")).toBe("true");
    expect(form.get("message_type")).toBe("outgoing");
    expect(form.get("content")).toBe("**Documentos anexos** (2)\n\n- Contrato assinado.pdf\n- Convocação.pdf\n\nAssinado pela diretora");
    expect((form.getAll("attachments[]") as File[]).map((f) => f.name)).toEqual(["Contrato assinado.pdf", "Convocação.pdf"]);
  });

  it("acima de 40 MB não envia; erro do servidor traz o link", async () => {
    const m = mock();
    await expect(sendPrivateFiles(s, 1, "x", [file("grande.pdf", 41 * 1024 * 1024)], m.fn)).rejects.toThrow(/40 MB/);
    expect(m.sent).toEqual([]);
    const e = (await sendPrivateFiles(s, 7, "x", [file("a.pdf")], mock({ status: 413 }).fn).catch((x) => x)) as ChatwootError;
    expect(e.message).toMatch(/HTTP 413 \(arquivo grande demais/);
    expect(e.link).toMatch(/conversations\/7$/);
  });

  it("ao abrir o ticket: nota de ativação, etiqueta e depois a nota com os anexos", async () => {
    const m = mock();
    const dados = Object.fromEntries(cw.CHATWOOT_FIELDS.map((k) => [k, k === "email_cliente" ? "c@x.com" : "x"])) as cw.ChatwootData;
    await openActivationTicket(s, dados, m.fn, [file("Contrato.pdf")]);
    expect(m.sent.map((x) => x.path)).toEqual(["/contacts/search?q=c%40x.com", "/conversations", "/conversations/555/messages", "/conversations/555/labels", "/conversations/555/messages"]);
    expect(m.sent.at(-1)!.body).toBeInstanceOf(FormData);
  });

  it("falha nos anexos depois de criar a conversa: o erro traz o link (não reenviar)", async () => {
    const dados = Object.fromEntries(cw.CHATWOOT_FIELDS.map((k) => [k, k === "email_cliente" ? "c@x.com" : "x"])) as cw.ChatwootData;
    const e = (await openActivationTicket(s, dados, mock({ status: 500 }).fn, [file("Contrato.pdf")]).catch((x) => x)) as ChatwootError;
    expect(e.link).toMatch(/conversations\/555$/);
    expect(e.message).toMatch(/já foi criada/);
  });

  it("no cartão: a nota do ticket lista os anexos; envio posterior vira nota própria", async () => {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Antenor", role: "admin" });
    const ctx = { ...sys, userId: me };
    const pl = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "P" }] });
    const p = createPerson(db, ctx, { name: "Rozi", email: "r@x.com" });
    const card = createCard(db, ctx, { pipelineId: pl, title: "Licenças", personId: p });
    const link = "https://suporte.powercubus.com.br/app/accounts/1/conversations/2316";
    cw.recordChatwootTicket(db, ctx, card, { conversationId: 2316, link, data: cw.chatwootContext(db, card).data, attachments: ["Contrato assinado.pdf"] });
    expect(listNotes(db, "deal", card)[0]!.body).toContain("Anexos enviados: Contrato assinado.pdf");
    cw.recordChatwootAttachments(db, ctx, card, { conversationId: 2316, names: ["Convocação.pdf"] });
    expect(listNotes(db, "deal", card)[0]!.body).toBe(`Documentos enviados ao Chatwoot (conversa 2316):\n${link}\n\n- Convocação.pdf`);
    expect(() => cw.recordChatwootAttachments(db, ctx, card, { conversationId: 1, names: ["a"] })).toThrow(/não está registrado/);
  });
});
