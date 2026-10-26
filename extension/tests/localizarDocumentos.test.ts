// Localizar documentos: a lista para a busca e a gravação do novo lugar dos
// arquivos (caminho na pasta ou navegador), com registro na auditoria e só
// para administradores.
import { describe, expect, it } from "vitest";
import * as docs from "../src/db/documents";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

const sha = (c: string) => c.repeat(64);

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const admin = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ana = createUser(db, sys, { name: "Ana", role: "vendedor" });
  const ctx = { ...sys, userId: admin };
  const typeId = docs.listDocumentTypes(db)[0]!.id;
  const contrato = docs.createDocument(db, ctx, {
    name: "Contrato Perseus",
    typeId,
    file: { sha256: sha("a"), mime: "application/pdf", size: 530, filename: "Contrato.pdf", location: "folder", path: "2026-10/Contrato Perseus (aaaaaaaa).pdf" },
  });
  return { db, ctx, admin, ana, contrato };
}

describe("Localizar documentos", () => {
  it("lista os arquivos com nome, tamanho e caminho atual", async () => {
    const { db } = await setup();
    expect(docs.locateBlobs(db)).toMatchObject([
      { sha256: sha("a"), location: "folder", path: "2026-10/Contrato Perseus (aaaaaaaa).pdf", size_bytes: 530, name: "Contrato Perseus", filename: "Contrato.pdf" },
    ]);
  });

  it("grava o novo caminho e registra na auditoria do documento", async () => {
    const { db, ctx, contrato } = await setup();
    const blob = docs.locateBlobs(db)[0]!;
    expect(docs.relocateBlobs(db, ctx, [{ blobId: blob.id, location: "folder", path: "Contratos/Contrato Perseus (aaaaaaaa).pdf" }])).toBe(1);
    expect(docs.locateBlobs(db)[0]!.path).toBe("Contratos/Contrato Perseus (aaaaaaaa).pdf");
    expect(docs.documentAudit(db, contrato).map((a) => a.text)).toContain('Arquivo localizado em "Contratos/Contrato Perseus (aaaaaaaa).pdf"');
    // Recuperado para o navegador: sem caminho.
    docs.relocateBlobs(db, ctx, [{ blobId: blob.id, location: "browser", path: "ignorado" }]);
    expect(docs.locateBlobs(db)[0]).toMatchObject({ location: "browser", path: null });
    expect(() => docs.relocateBlobs(db, ctx, [{ blobId: blob.id, location: "folder", path: null }])).toThrow(/Caminho/);
  });

  it("só administrador relocaliza", async () => {
    const { db, ctx, ana } = await setup();
    const blob = docs.locateBlobs(db)[0]!;
    const item = { items: [{ blobId: blob.id, location: "folder" as const, path: "x/y.pdf" }] };
    expect(() => methods["files.relocate"](db, { ...ctx, userId: ana }, item)).toThrow(/Sem permissão/);
    expect(methods["files.relocate"](db, ctx, item)).toBe(1);
  });
});
