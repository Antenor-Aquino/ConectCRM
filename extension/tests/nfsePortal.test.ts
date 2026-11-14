// NFS-e fase 3 (spec 19): campos do Emissor Nacional por etapa e registro da nota emitida.
import { describe, expect, it } from "vitest";
import { listNotes } from "../src/db/notes";
import { createOrganization } from "../src/db/contacts";
import { createCard, setDealItems } from "../src/db/deals";
import { createIssuer, markNfseIssued, nfseDraftForCard, nfsePending, saveNfseDraft } from "../src/db/nfse";
import { createPipeline } from "../src/db/pipelines";
import { createProduct } from "../src/db/products";
import { createUser } from "../src/db/users";
import { buildPortalPayload } from "../src/lib/nfse/portalSteps";
import { freshDb } from "./helpers";

const KEY = "31062002228288572000137000000000000126110000000001";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pc = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const a = createIssuer(db, ctx, { cnpj: "28.288.572/0001-37", legalName: "Stepple", cityIbge: "3106200" });
  createIssuer(db, ctx, { cnpj: "68.153.622/0001-93", legalName: "PowerCubus", cityIbge: "3106200" });
  const org = createOrganization(db, ctx, {
    name: "Caixa Escolar",
    legalName: "Caixa Escolar Prof Maria Jose",
    cnpj: "20.597.183/0001-81",
    email: "escola@educacao.mg.gov.br",
    cep: "39100-000",
    street: "Rua da Glória",
    number: "132",
    district: "Centro",
    city: "Diamantina",
    state: "MG",
  });
  const prod = createProduct(db, ctx, { name: "Certificado A3", kind: "servico", nfseTribNac: "010901" });
  const card = createCard(db, ctx, { pipelineId: pc, title: "Certificado", organizationId: org });
  setDealItems(db, ctx, card, [{ productId: prod, description: "Certificado Digital e-CNPJ A3", unitPriceCents: 30000 }]);
  saveNfseDraft(db, ctx, card, { issuerId: a, description: "Processo De Compra: 2026191944\nCertificado Digital e-CNPJ A3", notes: "Empenho 55/2026", orderNumber: "2026191944" });
  return { db, ctx, card };
}

describe("NFS-e — Emissor Nacional", () => {
  it("monta os campos de cada etapa com os rótulos do guia oficial", async () => {
    const { db, card } = await setup();
    const p = buildPortalPayload(nfseDraftForCard(db, card, { today: new Date("2026-11-14T12:00:00Z") }), "producao_restrita", ["28288572000137", "68153622000193"]);
    expect(p.issuer).toEqual({ cnpj: "28288572000137", name: "Stepple" });
    expect(p.otherCnpjs).toEqual(["68153622000193"]);
    const v = (step: string, title: RegExp) => p.fields.find((f) => f.step === step && title.test(f.title))?.value;
    expect(v("pessoas", /competência/)).toBe("14/11/2026");
    expect(v("pessoas", /CNPJ do tomador/)).toBe("20597183000181");
    expect(v("pessoas", /^CEP/)).toBe("39100000");
    expect(p.fields.find((f) => f.title === "CNPJ do tomador")?.section).toBe("Tomador");
    expect(v("servico", /Código de tributação/)).toBe("01.09.01");
    expect(v("servico", /Descrição do serviço/)).toBe("Processo De Compra: 2026191944\nCertificado Digital e-CNPJ A3");
    expect(v("servico", /Informações complementares/)).toBe("Empenho 55/2026");
    expect(v("servico", /pedido/)).toBe("2026191944");
    expect(v("valores", /Valor do serviço/)).toBe("300,00");
  });

  it("nota emitida: grava número e chave, deixa nota no cartão e trava o rascunho", async () => {
    const { db, ctx, card } = await setup();
    expect(() => markNfseIssued(db, ctx, card, { accessKey: "123", environment: "producao" })).toThrow(/50 caracteres/);
    markNfseIssued(db, ctx, card, { accessKey: KEY.replace(/(\d{10})/g, "$1 "), number: "126", environment: "producao_restrita" });
    const d = nfseDraftForCard(db, card);
    expect(d.issued).toMatchObject({ number: "126", accessKey: KEY, environment: "producao_restrita" });
    expect(nfsePending(d).map((p) => p.field)).toEqual(["issued"]);
    expect(listNotes(db, "deal", card)[0]!.body).toMatch(/NFS-e nº 126 emitida.*produção restrita[\s\S]*Chave de acesso: 31062002/);
    markNfseIssued(db, ctx, card, { accessKey: KEY, number: "126", environment: "producao_restrita" }); // ler de novo: nada muda
    expect(listNotes(db, "deal", card)).toHaveLength(1);
    expect(() => markNfseIssued(db, ctx, card, { accessKey: "9".repeat(50), environment: "producao" })).toThrow(/já tem uma NFS-e/);
    expect(() => saveNfseDraft(db, ctx, card, { description: "outro" })).toThrow(/já foi emitida/);
  });
});
