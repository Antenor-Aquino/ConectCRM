// NFS-e Nacional, fase 1 (spec 19): empresas emissoras, tabelas oficiais, rascunho e pendências.
import { describe, expect, it } from "vitest";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCard, setDealItems } from "../src/db/deals";
import { createIssuer, deleteIssuer, issuerForPipeline, listIssuers, nfseDraftForCard, nfsePending, updateIssuer } from "../src/db/nfse";
import { createPipeline } from "../src/db/pipelines";
import { createProduct, getProduct, listProducts, updateProduct } from "../src/db/products";
import { createUser } from "../src/db/users";
import { buscarServicos, formatTribNac, municipioPorNome, servicoNacional } from "../src/lib/nfse/tabelas";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pc = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const st = createPipeline(db, ctx, { name: "Stepple", type: "comercial", stages: [{ name: "Prospect" }] });
  return { db, ctx, pc, st };
}

describe("NFS-e — tabelas oficiais", () => {
  it("município pelo nome e UF, sem acento e sem diferença de maiúsculas", () => {
    expect(municipioPorNome("São Paulo", "SP")?.ibge).toBe("3550308");
    expect(municipioPorNome("sao paulo", "sp")?.ibge).toBe("3550308");
    expect(municipioPorNome("Belo Horizonte", "MG")?.ibge).toBe("3106200");
    expect(municipioPorNome("São Paulo", "RJ")).toBeNull();
  });
  it("lista nacional de serviços: código de 6 dígitos e busca por palavra ou código", () => {
    expect(servicoNacional("010501")?.descricao).toMatch(/Licenciamento/);
    expect(formatTribNac("010501")).toBe("01.05.01");
    expect(buscarServicos("consultoria informática").map((s) => s.codigo)).toContain("010601");
    expect(buscarServicos("0107").map((s) => s.codigo)).toContain("010701");
  });
});

describe("NFS-e — empresas emissoras", () => {
  it("valida CNPJ, não duplica e liga cada funil a uma empresa só", async () => {
    const { db, ctx, pc, st } = await setup();
    expect(() => createIssuer(db, ctx, { cnpj: "11.111.111/1111-11", legalName: "X" })).toThrow(/CNPJ/);
    const a = createIssuer(db, ctx, { cnpj: "28.288.572/0001-37", legalName: "Empresa A", cityIbge: "3106200", access: "a1", pipelineIds: [pc] });
    expect(() => createIssuer(db, ctx, { cnpj: "28288572000137", legalName: "Repetida" })).toThrow(/já está cadastrado/);
    const b = createIssuer(db, ctx, { cnpj: "68.153.622/0001-93", legalName: "Empresa B", access: "a3", pipelineIds: [st] });
    expect(issuerForPipeline(db, pc)?.id).toBe(a);
    expect(issuerForPipeline(db, st)?.id).toBe(b);
    // Funil passa para a outra empresa
    updateIssuer(db, ctx, b, { pipelineIds: [st, pc] });
    expect(listIssuers(db).find((i) => i.id === a)!.pipeline_ids).toEqual([]);
    expect(issuerForPipeline(db, pc)?.id).toBe(b);
    expect(() => updateIssuer(db, ctx, a, { cityIbge: "9999999" })).toThrow(/IBGE/);
    deleteIssuer(db, ctx, b);
    // Só uma empresa ativa: vale para todos os funis
    expect(issuerForPipeline(db, pc)?.id).toBe(a);
  });

  it("serviço guarda código de tributação nacional e NBS válidos", async () => {
    const { db, ctx } = await setup();
    const p = createProduct(db, ctx, { name: "Licença", kind: "servico", nfseTribNac: "01.05.01", nfseNbs: "1.1503.00.00" });
    expect(getProduct(db, p)).toMatchObject({ nfse_trib_nac: "010501", nfse_nbs: "115030000" });
    expect(listProducts(db).find((x) => x.id === p)).toMatchObject({ nfse_trib_nac: "010501", nfse_nbs: "115030000" });
    expect(() => updateProduct(db, ctx, p, { nfseTribNac: "999999" })).toThrow(/não existe na lista nacional/);
    expect(() => updateProduct(db, ctx, p, { nfseNbs: "123" })).toThrow(/NBS/);
  });
});

describe("NFS-e — rascunho e pendências", () => {
  it("cartão completo: tomador da organização, serviços dos itens, sem pendências", async () => {
    const { db, ctx, pc } = await setup();
    createIssuer(db, ctx, { cnpj: "28.288.572/0001-37", legalName: "Empresa A", cityIbge: "3106200", pipelineIds: [pc] });
    const org = createOrganization(db, ctx, {
      name: "IED",
      legalName: "Instituto de Ensino LTDA",
      cnpj: "68.153.622/0001-93",
      cep: "01310-100",
      street: "Av. Paulista",
      number: "1000",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });
    const lic = createProduct(db, ctx, { name: "Licença anual", kind: "servico", nfseTribNac: "010501" });
    const card = createCard(db, ctx, { pipelineId: pc, title: "IED - licenças", organizationId: org });
    setDealItems(db, ctx, card, [{ productId: lic, description: "Licença PowerCubus 2027", quantity: 2, unitPriceCents: 50000 }]);
    const d = nfseDraftForCard(db, card, new Date("2026-11-14T12:00:00Z"));
    expect(d.issuer?.legal_name).toBe("Empresa A");
    expect(d.taker).toMatchObject({ kind: "organization", name: "Instituto de Ensino LTDA", address: { cityIbge: "3550308" } });
    expect(d.services).toEqual([expect.objectContaining({ tribNac: "010501", description: "Licença PowerCubus 2027", valueCents: 100000 })]);
    expect(d.competence).toBe("2026-11-14");
    expect(nfsePending(d)).toEqual([]);
  });

  it("aponta o que falta: empresa do funil, documento do tomador, código do serviço, cidade fora do IBGE", async () => {
    const { db, ctx, pc, st } = await setup();
    createIssuer(db, ctx, { cnpj: "28.288.572/0001-37", legalName: "A", cityIbge: "3106200", pipelineIds: [pc] });
    createIssuer(db, ctx, { cnpj: "68.153.622/0001-93", legalName: "B", cityIbge: "3106200" });
    const org = createOrganization(db, ctx, { name: "Escola X", city: "Cidade Inventada", state: "MG", cep: "30000-000", street: "Rua 1", number: "1", district: "Centro" });
    const consult = createProduct(db, ctx, { name: "Consultoria", kind: "servico" });
    const hw = createProduct(db, ctx, { name: "Leitor", kind: "produto" });
    const card = createCard(db, ctx, { pipelineId: st, title: "Escola X", organizationId: org });
    setDealItems(db, ctx, card, [
      { productId: consult, description: "Consultoria", unitPriceCents: 30000 },
      { productId: hw, description: "Leitor biométrico", unitPriceCents: 10000 },
    ]);
    const msgs = nfsePending(nfseDraftForCard(db, card)).map((p) => `${p.level}:${p.field}`);
    expect(msgs).toEqual(
      expect.arrayContaining(["error:issuer", "error:taker.document", "error:taker.address.city", "error:service.tribNac", "warning:products"]),
    );
  });

  it("sem organização: o contato é o tomador (CPF); sem itens, vale o valor do cartão", async () => {
    const { db, ctx, pc } = await setup();
    createIssuer(db, ctx, { cnpj: "28.288.572/0001-37", legalName: "A", cityIbge: "3106200" });
    const p = createPerson(db, ctx, { name: "Cristiane", cpf: "529.982.247-25" });
    const card = createCard(db, ctx, { pipelineId: pc, title: "Treinamento", personId: p, valueCents: 120000 });
    const d = nfseDraftForCard(db, card);
    expect(d.taker).toMatchObject({ kind: "person", document: "52998224725", name: "Cristiane", address: null });
    expect(d.services[0]).toMatchObject({ description: "Treinamento", valueCents: 120000, tribNac: null });
    expect(nfsePending(d).map((x) => x.field)).toEqual(["service.tribNac"]);
  });
});
