// Pastas do GED: criar, subpastas (até 5 níveis), nomes, mover documentos e
// pastas, excluir (o conteúdo sobe) e restaurar, filtro, contagens e histórico.
import { describe, expect, it } from "vitest";
import * as docs from "../src/db/documents";
import * as folders from "../src/db/documentFolders";
import { listTrash, restoreTrashItem } from "../src/db/trash";
import { createUser, getViewer } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

let n = 0;
const file = (filename: string): docs.FileRef => ({ sha256: (++n).toString(16).padStart(64, "0"), mime: "application/pdf", size: 10, filename, location: "browser" });

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const admin = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ana = createUser(db, sys, { name: "Ana", role: "vendedor" });
  const ctx = { ...sys, userId: admin };
  const typeId = docs.listDocumentTypes(db)[0]!.id;
  const doc = (name: string, folderId?: string | null) => docs.createDocument(db, ctx, { name, typeId, folderId, file: file(`${name}.pdf`) });
  return { db, sys, ctx, admin, ana, doc };
}

describe("GED — pastas", () => {
  it("cria pastas e subpastas, sem nome repetido no mesmo lugar e até 5 níveis", async () => {
    const { db, ctx } = await setup();
    const comercial = folders.createFolder(db, ctx, { name: "Comercial" });
    const propostas = folders.createFolder(db, ctx, { name: "Propostas", parentId: comercial });
    expect(() => folders.createFolder(db, ctx, { name: "propostas", parentId: comercial })).toThrow(/Já existe uma pasta/);
    // mesmo nome em outra pasta pode
    expect(folders.createFolder(db, ctx, { name: "Propostas" })).toBeTruthy();
    expect(() => folders.createFolder(db, ctx, { name: "A/B" })).toThrow(/não pode ter/);
    let parent = propostas;
    for (const name of ["N3", "N4", "N5"]) parent = folders.createFolder(db, ctx, { name, parentId: parent });
    expect(() => folders.createFolder(db, ctx, { name: "N6", parentId: parent })).toThrow(/até 5 níveis/);
    expect(folders.folderPaths(db).get(parent)).toEqual(["Comercial", "Propostas", "N3", "N4", "N5"]);
  });

  it("move pastas sem criar ciclo nem passar de 5 níveis", async () => {
    const { db, ctx } = await setup();
    const a = folders.createFolder(db, ctx, { name: "A" });
    const b = folders.createFolder(db, ctx, { name: "B", parentId: a });
    const c = folders.createFolder(db, ctx, { name: "C" });
    expect(() => folders.moveFolder(db, ctx, a, b)).toThrow(/dentro dela mesma/);
    folders.moveFolder(db, ctx, c, b);
    expect(folders.folderPaths(db).get(c)).toEqual(["A", "B", "C"]);
    const d = folders.createFolder(db, ctx, { name: "D" });
    const e = folders.createFolder(db, ctx, { name: "E", parentId: d });
    folders.createFolder(db, ctx, { name: "F", parentId: e });
    // A > B > C (3) + D > E > F (3) = 6 níveis
    expect(() => folders.moveFolder(db, ctx, d, c)).toThrow(/até 5 níveis/);
    folders.renameFolder(db, ctx, c, "Contratos");
    expect(folders.folderPaths(db).get(c)).toEqual(["A", "B", "Contratos"]);
  });

  it("documento em uma pasta só; filtro pela pasta, com subpastas e Sem pasta; busca pelo nome da pasta", async () => {
    const { db, ctx, doc } = await setup();
    const comercial = folders.createFolder(db, ctx, { name: "Comercial" });
    const modelos = folders.createFolder(db, ctx, { name: "Modelos", parentId: comercial });
    const d1 = doc("Tabela de preços", comercial);
    const d2 = doc("Modelo de proposta");
    doc("Planilha solta");
    expect(folders.moveDocumentsToFolder(db, ctx, [d2], modelos)).toBe(1);
    expect(folders.moveDocumentsToFolder(db, ctx, [d2], modelos)).toBe(0);
    const names = (f: docs.DocumentFilter) => docs.listDocuments(db, f).items.map((i) => i.name).sort();
    expect(names({ folderId: comercial })).toEqual(["Tabela de preços"]);
    expect(names({ folderId: comercial, folderDeep: true })).toEqual(["Modelo de proposta", "Tabela de preços"]);
    expect(names({ folderId: "none" })).toEqual(["Planilha solta"]);
    expect(names({ search: "modelos" })).toEqual(["Modelo de proposta"]);
    const item = docs.listDocuments(db, { folderId: modelos }).items[0]!;
    expect(item.folder_path).toEqual(["Comercial", "Modelos"]);
    expect(docs.getDocument(db, d1)!.folder_path).toEqual(["Comercial"]);

    const tree = docs.folderTree(db, null);
    const c = tree.folders.find((f) => f.id === comercial)!;
    expect([c.count, c.total, tree.none, tree.all]).toEqual([1, 2, 1, 3]);
  });

  it("excluir a pasta sobe documentos e subpastas para a pasta de cima; restaurar devolve tudo", async () => {
    const { db, ctx, doc, admin } = await setup();
    const comercial = folders.createFolder(db, ctx, { name: "Comercial" });
    const propostas = folders.createFolder(db, ctx, { name: "Propostas", parentId: comercial });
    const antigas = folders.createFolder(db, ctx, { name: "Antigas", parentId: propostas });
    const d = doc("Proposta Alfa", propostas);
    const notice = folders.deleteFolder(db, ctx, propostas);
    expect(notice.label).toBe("Pasta “Propostas”");
    expect(docs.getDocument(db, d)!.folder_id).toBe(comercial);
    expect(folders.folderPaths(db).get(antigas)).toEqual(["Comercial", "Antigas"]);
    expect(docs.listDocuments(db, {}).total).toBe(1); // o documento não foi junto para a lixeira

    const v = getViewer(db, admin);
    const item = listTrash(db, v).find((t) => t.entity === "document_folder")!;
    expect(item.title).toBe("Propostas");
    restoreTrashItem(db, ctx, v, item.id);
    expect(docs.getDocument(db, d)!.folder_id).toBe(propostas);
    expect(folders.folderPaths(db).get(antigas)).toEqual(["Comercial", "Propostas", "Antigas"]);
  });

  it("não exclui se uma subpasta colidir com o nome de outra na pasta de cima", async () => {
    const { db, ctx } = await setup();
    const a = folders.createFolder(db, ctx, { name: "A" });
    folders.createFolder(db, ctx, { name: "Modelos" });
    folders.createFolder(db, ctx, { name: "Modelos", parentId: a });
    expect(() => folders.deleteFolder(db, ctx, a)).toThrow(/Renomeie uma delas/);
    expect(folders.activeFolders(db)).toHaveLength(3);
  });

  it("o histórico do documento registra a mudança de pasta", async () => {
    const { db, ctx, doc } = await setup();
    const contratos = folders.createFolder(db, ctx, { name: "Contratos" });
    const d = doc("Contrato padrão");
    folders.moveDocumentsToFolder(db, ctx, [d], contratos);
    folders.moveDocumentsToFolder(db, ctx, [d], null);
    const texts = docs.documentAudit(db, d).map((a) => a.text);
    expect(texts).toContain("Moveu de Sem pasta para “Contratos”");
    expect(texts).toContain("Moveu de “Contratos” para Sem pasta");
  });

  it("pelo RPC: qualquer usuário organiza; excluir só o administrador ou quem criou", async () => {
    const { db, sys, ana, admin } = await setup();
    const as = (userId: string) => ({ ...sys, userId });
    const f = methods["documents.folderCreate"](db, as(admin), { name: "Administrativo" });
    const g = methods["documents.folderCreate"](db, as(ana), { name: "Da Ana" });
    methods["documents.folderRename"](db, as(ana), { id: f, name: "Administração" });
    expect(() => methods["documents.folderDelete"](db, as(ana), { id: f })).toThrow(/administrador ou quem criou/);
    expect(methods["documents.folderDelete"](db, as(ana), { id: g }).__trash).toBe(true);
    expect(methods["documents.folders"](db, as(ana)).folders.map((x) => x.name)).toEqual(["Administração"]);
  });

  it("Copiloto: documentos de uma pasta (pelo nome ou caminho) e lista de pastas", async () => {
    const { db, sys, admin, doc, ctx } = await setup();
    const comercial = folders.createFolder(db, ctx, { name: "Comercial" });
    const propostas = folders.createFolder(db, ctx, { name: "Propostas", parentId: comercial });
    doc("Proposta Alfa", propostas);
    doc("Tabela", comercial);
    const call = (p: { texto?: string; pasta?: string }) => methods["copilot.documents"](db, { ...sys, userId: admin }, p) as Record<string, unknown>;
    expect((call({ pasta: "comercial/propostas" }).documentos as { nome: string; pasta: string }[]).map((d) => [d.nome, d.pasta])).toEqual([
      ["Proposta Alfa", "Comercial › Propostas"],
    ]);
    expect(call({ pasta: "Comercial" }).total).toBe(2);
    expect(call({ pasta: "Inexistente" }).erro).toMatch(/não encontrada/);
    expect(call({}).pastas).toEqual([
      { pasta: "Comercial", documentos: 2 },
      { pasta: "Comercial › Propostas", documentos: 1 },
    ]);
  });
});
