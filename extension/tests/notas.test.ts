import { describe, expect, it } from "vitest";
import { createPipeline } from "../src/db/pipelines";
import { createCard } from "../src/db/deals";
import { addNote, listNotes, updateNote } from "../src/db/notes";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

describe("editar nota", () => {
  it("troca o texto e os documentos; marca 'editada' só quando o texto muda", async () => {
    const { db, ctx } = await freshDb();
    const actx = { ...ctx, userId: createUser(db, ctx, { name: "Ana", role: "admin" }) };
    const p = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const card = createCard(db, actx, { pipelineId: p, title: "Escola" });
    const id = addNote(db, actx, "deal", card, "Primeira versão");
    updateNote(db, actx, id, { pinned: true });
    expect(listNotes(db, "deal", card)[0]).toMatchObject({ body: "Primeira versão", pinned: 1, edited_at: null });
    updateNote(db, actx, id, { body: "Versão corrigida https://x.com", documentIds: [] });
    const [n] = listNotes(db, "deal", card);
    expect(n!.body).toBe("Versão corrigida https://x.com");
    expect(n!.edited_at).toBeTruthy();
    expect(() => updateNote(db, actx, id, { documentIds: ["nao-existe"] })).toThrow(/Documento da nota/);
    expect(() => updateNote(db, actx, id, { body: "  " })).toThrow(/Escreva a nota/);
  });
});
