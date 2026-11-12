// GED + To Do: arquivos e imagens das observações vinculados à tarefa do To Do.
import { describe, expect, it } from "vitest";
import { createPerson } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import * as docs from "../src/db/documents";
import { createPipeline } from "../src/db/pipelines";
import * as todo from "../src/db/todo";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

let n = 0;
const file = (filename: string, mime = "image/png"): docs.FileRef => ({ sha256: (++n).toString(16).padStart(64, "0"), mime, size: 100, filename, location: "browser" });

describe("GED na tarefa do To Do", () => {
  it("anexo vai para a tarefa (e para o cartão/contato dela); só o dono vê; aparece na contagem e na auditoria", async () => {
    const { db, ctx: sys } = await freshDb();
    createUser(db, sys, { name: "Admin", role: "admin" });
    const me = createUser(db, sys, { name: "Antenor", role: "vendedor" });
    const ana = createUser(db, sys, { name: "Ana", role: "vendedor" });
    const ctx = { ...sys, userId: me };
    const anaCtx = { ...sys, userId: ana };
    const pid = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const person = createPerson(db, ctx, { name: "Gabi" });
    const deal = createCard(db, ctx, { pipelineId: pid, title: "Financie", personId: person, ownerId: me });
    const solta = todo.createTodoTask(db, ctx, { title: "Avisar Gabi" });
    const ligada = todo.createTodoTask(db, ctx, { title: "Proposta INTCC", dealId: deal, personId: person });
    const type = docs.listDocumentTypes(db).find((t) => t.name === "Foto/imagem")!.id;

    // Imagem colada nas observações da tarefa solta: só a tarefa.
    expect(docs.contextLinks(db, "todo", solta)).toEqual([{ type: "todo", id: solta }]);
    const img = docs.createDocument(db, ctx, { name: "Imagem da tarefa", typeId: type, links: docs.contextLinks(db, "todo", solta), file: file("print.png") });
    expect(docs.documentsFor(db, "todo", solta).map((d) => d.id)).toEqual([img]);
    expect(docs.documentsFor(db, "todo", solta)[0]!.links.map((l) => [l.type, l.label])).toEqual([["todo", "Avisar Gabi"]]);
    expect(todo.getTodoTask(db, ctx, solta)!.docs).toBe(1);

    // Tarefa ligada ao cartão: o anexo vai também para o cartão e o contato.
    const pdf = docs.createDocument(db, ctx, { name: "Proposta", typeId: type, links: docs.contextLinks(db, "todo", ligada), file: file("proposta.pdf", "application/pdf") });
    expect(docs.documentsFor(db, "deal", deal).map((d) => d.id)).toEqual([pdf]);
    expect(docs.documentsFor(db, "person", person).map((d) => d.id)).toEqual([pdf]);

    // Permissão: a imagem só da tarefa de Antenor não aparece para Ana; a RPC recusa a tarefa de outro.
    expect(docs.canSeeDocument(db, { id: ana, role: "vendedor" } as never, img)).toBe(false);
    expect(docs.canSeeDocument(db, { id: me, role: "vendedor" } as never, img)).toBe(true);
    expect(() => methods["documents.forEntity"](db, anaCtx, { type: "todo", id: solta })).toThrow(/não encontrada/);
    expect(methods["documents.forEntity"](db, ctx, { type: "todo", id: solta }).map((d: { id: string }) => d.id)).toEqual([img]);

    // Auditoria e busca falam da tarefa.
    expect(docs.documentAudit(db, img).some((e) => e.text === "Vinculou à tarefa do To Do Avisar Gabi")).toBe(true);
    expect(docs.listDocuments(db, { search: "avisar gabi" }).items.map((d) => d.id)).toEqual([img]);
  });
});

describe("rótulo do vínculo da tarefa", () => {
  it("describeLinks mostra o título da tarefa", async () => {
    const { db, ctx: sys } = await freshDb();
    const me = createUser(db, sys, { name: "Admin", role: "admin" });
    const ctx = { ...sys, userId: me };
    const t = todo.createTodoTask(db, ctx, { title: "Avisar Gabi" });
    expect(docs.describeLinks(db, [{ type: "todo", id: t }]).map((l) => l.label)).toEqual(["Avisar Gabi"]);
  });
});
