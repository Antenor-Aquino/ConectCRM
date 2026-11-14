// NFS-e pela API (spec 20, B1): XML da DPS validado contra o esquema oficial (DPS_v1.01.xsd) e reserva do número.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCard, setDealItems } from "../src/db/deals";
import { createIssuer, getRowForTest, nfseDraftForCard, nfsePending, reserveDpsNumber, saveNfseDraft, updateIssuer } from "./nfseDpsHelpers";
import { createPipeline } from "../src/db/pipelines";
import { createProduct } from "../src/db/products";
import { createUser } from "../src/db/users";
import { brasiliaDateTime, buildDpsXml, dpsId } from "../src/lib/nfse/dps";
import { freshDb } from "./helpers";

const XSD = resolve(__dirname, "fixtures/nfse-xsd/DPS_v1.01.xsd");
const hasXmllint = (() => {
  try {
    execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
/**
 * Valida com o xmllint contra o XSD oficial; devolve "" quando válido ou as mensagens de erro.
 * O padrão do campo serie no XSD v1.01 ('^0{0,4}\d{1,5}$') usa ^ e $, que em XSD são
 * caracteres comuns: nenhum valor real passa no xmllint (a Receita aceita). Esse aviso é ignorado.
 */
function validate(xml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dps-"));
  const f = join(dir, "dps.xml");
  writeFileSync(f, xml);
  try {
    execFileSync("xmllint", ["--noout", "--schema", XSD, f], { stdio: "pipe" });
    return "";
  } catch (e) {
    const out = String((e as { stderr?: Buffer }).stderr ?? e);
    const errors = out.split("\n").filter((l) => l.includes("error") && !/element serie: .*facet 'pattern'.*\^0\{0,4\}/.test(l));
    return errors.join("\n");
  }
}

async function setup(opts: { person?: boolean } = {}) {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pc = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const issuer = createIssuer(db, ctx, { cnpj: "68.153.622/0001-93", legalName: "CLAUDIA TECNOLOGIA LIMITADA", cityIbge: "2611101", municipalReg: "99650737", simplesRate: 6, issRate: 2 });
  const prod = createProduct(db, ctx, { name: "Certificado A1", kind: "servico", nfseTribNac: "010901", nfseNbs: "1.1503.00.00" });
  let card: string;
  if (opts.person) {
    const p = createPerson(db, ctx, { name: "Cristiane & Cia <teste>", cpf: "529.982.247-25", email: "c@ied.edu.br" });
    card = createCard(db, ctx, { pipelineId: pc, title: "Treinamento", personId: p });
  } else {
    const org = createOrganization(db, ctx, {
      name: "Caixa Escolar",
      legalName: "CAIXA ESCOLAR PROFESSOR HILDEBRANDO PONTES",
      cnpj: "19.929.587/0001-46",
      email: "escola.160059@educacao.mg.gov.br",
      cep: "38067-230",
      street: "PRACA ANTONIO DELFINO",
      number: "53",
      district: "FABRICIO",
      city: "Uberaba",
      state: "MG",
    });
    card = createCard(db, ctx, { pipelineId: pc, title: "Certificado digital A1", organizationId: org });
  }
  setDealItems(db, ctx, card, [{ productId: prod, description: "Certificado digital A1", unitPriceCents: 5200 }]);
  saveNfseDraft(db, ctx, card, { issuerId: issuer, description: "Certificado digital A1 — Caixa Escolar Prof. Hildebrando Pontes", notes: "Processo de compra 22627840", orderNumber: "22627840" });
  return { db, ctx, card, issuer };
}

describe("NFS-e API — DPS", () => {
  it("Id e data no formato do leiaute", () => {
    expect(dpsId("2611101", "68.153.622/0001-93", "1", 7)).toBe(`DPS2611101268153622000193${"00001"}${"7".padStart(15, "0")}`);
    expect(dpsId("2611101", "68153622000193", "1", 7)).toHaveLength(45);
    expect(brasiliaDateTime(new Date("2026-11-14T13:05:09Z"))).toBe("2026-11-14T10:05:09-03:00");
  });

  it.skipIf(!hasXmllint)("tomador organização (CNPJ e endereço): XML válido no XSD oficial", async () => {
    const { db, ctx, card } = await setup();
    const n = reserveDpsNumber(db, ctx, card);
    const xml = buildDpsXml(nfseDraftForCard(db, card, { today: new Date("2026-11-14T12:00:00Z") }), { environment: "producao_restrita", issuedAt: new Date("2026-11-14T13:00:00Z"), ...n, appVersion: "ConectCRM 0.2.109" });
    expect(validate(xml)).toBe("");
    expect(xml).toContain("<tpAmb>2</tpAmb>");
    expect(xml).toContain("<regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib>");
    expect(xml).toContain("<IM>99650737</IM>");
    expect(xml).toContain("<toma><CNPJ>19929587000146</CNPJ><xNome>CAIXA ESCOLAR PROFESSOR HILDEBRANDO PONTES</xNome><end><endNac><cMun>3170107</cMun><CEP>38067230</CEP></endNac>");
    expect(xml).toContain("<cServ><cTribNac>010901</cTribNac><cNBS>115030000</cNBS><xDescServ>Certificado digital A1 — Caixa Escolar Prof. Hildebrando Pontes</xDescServ></cServ>");
    expect(xml).toContain("<infoCompl><xPed>22627840</xPed><xInfComp>Processo de compra 22627840</xInfComp></infoCompl>");
    expect(xml).toContain("<vServ>52.00</vServ>");
    expect(xml).toContain("<tpRetISSQN>1</tpRetISSQN><pAliq>2.00</pAliq>");
    expect(xml).toContain("<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib>");
    expect(xml).not.toMatch(/<\w+:/); // sem prefixo de namespace (E1228)
  });

  it.skipIf(!hasXmllint)("tomador pessoa (CPF), texto com & e <: escapado e válido", async () => {
    const { db, ctx, card } = await setup({ person: true });
    const xml = buildDpsXml(nfseDraftForCard(db, card), { environment: "producao", issuedAt: new Date(), ...reserveDpsNumber(db, ctx, card), appVersion: "ConectCRM 0.2.109" });
    expect(validate(xml)).toBe("");
    expect(xml).toContain("<toma><CPF>52998224725</CPF><xNome>Cristiane &amp; Cia &lt;teste&gt;</xNome><email>c@ied.edu.br</email></toma>");
    expect(xml).toContain("<tpAmb>1</tpAmb>");
  });

  it("número da DPS: reservado na 1ª tentativa, mantido ao reenviar, próximo para outra nota; trocar a empresa libera", async () => {
    const { db, ctx, card, issuer } = await setup();
    expect(reserveDpsNumber(db, ctx, card)).toEqual({ series: "1", number: 1 });
    expect(reserveDpsNumber(db, ctx, card)).toEqual({ series: "1", number: 1 });
    expect(getRowForTest(db, "nfse_issuer", issuer).dps_next).toBe(2);
    updateIssuer(db, ctx, issuer, { dpsSeries: "2", dpsNext: 40 });
    const other = createIssuer(db, ctx, { cnpj: "28.288.572/0001-37", legalName: "Stepple", cityIbge: "3106200", simplesRate: 6 });
    const d = nfseDraftForCard(db, card);
    saveNfseDraft(db, ctx, card, { issuerId: other, description: d.texts.description });
    expect(reserveDpsNumber(db, ctx, card)).toEqual({ series: "1", number: 1 }); // numeração da outra empresa
    saveNfseDraft(db, ctx, card, { issuerId: issuer, description: d.texts.description });
    expect(reserveDpsNumber(db, ctx, card)).toEqual({ series: "2", number: 40 });
    expect(() => updateIssuer(db, ctx, issuer, { dpsSeries: "50000" })).toThrow(/1 e 49999/);
  });

  it("ME/EPP sem alíquota do Simples: aviso no rascunho e erro ao montar a DPS", async () => {
    const { db, ctx, card, issuer } = await setup();
    updateIssuer(db, ctx, issuer, { simplesRate: null });
    const d = nfseDraftForCard(db, card);
    expect(nfsePending(d).find((p) => p.field === "issuer.simplesRate")?.level).toBe("warning");
    expect(() => buildDpsXml(d, { environment: "producao", issuedAt: new Date(), series: "1", number: 1, appVersion: "x" })).toThrow(/alíquota do Simples/);
  });
});
