// NFS-e pela API (spec 20, B3): respostas da Sefin e nota emitida com o XML.
import { describe, expect, it } from "vitest";
import { createCard } from "../src/db/deals";
import { createIssuer, markNfseIssued, nfseDraftForCard, saveNfseDraft } from "../src/db/nfse";
import { listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { nfseNumberFromXml, sefinErrors } from "../src/lib/nfse/fiscal";
import { freshDb } from "./helpers";

describe("NFS-e API — respostas da Sefin", () => {
  it("erros em texto, nas formas que a API devolve", () => {
    expect(sefinErrors({ httpStatus: 400, body: { erros: [{ Codigo: "E0712", Descricao: "Para ME/EPP indTotTrib nunca poderá ser informado.", Complemento: null }] } })).toEqual([
      "E0712 — Para ME/EPP indTotTrib nunca poderá ser informado.",
    ]);
    expect(sefinErrors({ httpStatus: 400, body: { erro: { codigo: "E1235", descricao: "Falha no esquema XML", complemento: "elemento serie" } } })).toEqual(["E1235 — Falha no esquema XML — elemento serie"]);
    expect(sefinErrors({ httpStatus: 401, text: "Certificado não informado" })).toEqual(["Certificado não informado"]);
    expect(sefinErrors({ httpStatus: 500 })).toEqual(["A Receita respondeu HTTP 500 sem detalhes."]);
  });
  it("número da NFS-e no XML", () => {
    expect(nfseNumberFromXml(`<NFSe><infNFSe Id="NFS1"><nNFSe>126</nNFSe></infNFSe></NFSe>`)).toBe("126");
    expect(nfseNumberFromXml(null)).toBeNull();
  });
  it("emitida pela API: guarda o XML e diz na nota do cartão", async () => {
    const { db, ctx: sys } = await freshDb();
    const ctx = { ...sys, userId: createUser(db, sys, { name: "A", role: "admin" }) };
    const pc = createPipeline(db, ctx, { name: "P", type: "comercial", stages: [{ name: "S" }] });
    const i = createIssuer(db, ctx, { cnpj: "68.153.622/0001-93", legalName: "C", cityIbge: "2611101", simplesRate: 6 });
    const card = createCard(db, ctx, { pipelineId: pc, title: "T" });
    saveNfseDraft(db, ctx, card, { issuerId: i, description: "Serviço" });
    const xml = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS1"><nNFSe>7</nNFSe></infNFSe></NFSe>`;
    markNfseIssued(db, ctx, card, { accessKey: "2".repeat(50), number: "7", environment: "producao", nfseXml: xml, via: "api" });
    expect(nfseDraftForCard(db, card).issued).toMatchObject({ number: "7", xml });
    expect(listNotes(db, "deal", card)[0]!.body).toMatch(/emitida pela API do Emissor Nacional \(ConectCRM Fiscal\)/);
  });
});
