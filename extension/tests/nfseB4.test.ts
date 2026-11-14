// NFS-e pela API (spec 20, B4): cancelamento (pedido de evento e101101) e DANFSe em PDF.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createOrganization } from "../src/db/contacts";
import { createCard, setDealItems } from "../src/db/deals";
import { createIssuer, markNfseCanceled, markNfseIssued, nfseDraftForCard, nfsePending, reopenNfseDraft, reserveDpsNumber, saveNfseDraft } from "../src/db/nfse";
import { createPipeline } from "../src/db/pipelines";
import { createProduct } from "../src/db/products";
import { createUser } from "../src/db/users";
import { many, one } from "../src/db/sql";
import { buildDpsXml } from "../src/lib/nfse/dps";
import { buildCancelEventXml, cancelEventId, cancelInputError } from "../src/lib/nfse/evento";
import { brDate, brDoc, brMoney, buildDanfsePdf, danfseData, danfseFileName, parseXml, xtext } from "../src/lib/nfse/danfse";
import { freshDb } from "./helpers";

const XSD_EVT = resolve(__dirname, "fixtures/nfse-xsd/pedRegEvento_v1.01.xsd");
const hasXmllint = (() => {
  try {
    execFileSync("xmllint", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
function validate(xml: string, xsd: string): string {
  const f = join(mkdtempSync(join(tmpdir(), "evt-")), "x.xml");
  writeFileSync(f, xml);
  try {
    execFileSync("xmllint", ["--noout", "--schema", xsd, f], { stdio: "pipe" });
    return "";
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
}

const KEY = "26111012268153622000193000000000012626110000000001";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pc = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const issuer = createIssuer(db, ctx, { cnpj: "68.153.622/0001-93", legalName: "CLAUDIA TECNOLOGIA LIMITADA", cityIbge: "2611101", municipalReg: "99650737", simplesRate: 6, issRate: 2 });
  const prod = createProduct(db, ctx, { name: "Certificado A1", kind: "servico", nfseTribNac: "010901", nfseNbs: "1.1503.00.00" });
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
  const card = createCard(db, ctx, { pipelineId: pc, title: "Certificado digital A1", organizationId: org });
  setDealItems(db, ctx, card, [{ productId: prod, description: "Certificado digital A1", unitPriceCents: 5200 }]);
  saveNfseDraft(db, ctx, card, { issuerId: issuer, description: "Certificado digital A1 — Caixa Escolar Prof. Hildebrando Pontes", notes: "Processo de compra 22627840", orderNumber: "22627840" });
  return { db, ctx, card, issuer };
}

/** NFS-e como a Sefin devolve: infNFSe com os dados gerados + a DPS enviada (assinatura omitida). */
function nfseFromDps(dps: string, o: { tpAmb?: 1 | 2 } = {}): string {
  const inner = dps.replace(/<\?xml[^>]*\?>/, "").replace(/ xmlns="[^"]*"/, "");
  const withAmb = o.tpAmb ? inner.replace(/<tpAmb>\d<\/tpAmb>/, `<tpAmb>${o.tpAmb}</tpAmb>`) : inner;
  return (
    `<?xml version="1.0" encoding="utf-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${KEY}">` +
    `<xLocEmi>Petrolina</xLocEmi><xLocPrestacao>Petrolina</xLocPrestacao><nNFSe>126</nNFSe><cLocIncid>2611101</cLocIncid><xLocIncid>Petrolina</xLocIncid>` +
    `<xTribNac>Elaboração de programas de computadores, inclusive de jogos eletrônicos, independentemente da arquitetura construtiva da máquina em que o programa será executado</xTribNac>` +
    `<verAplic>SefinNac_1.6</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><procEmi>1</procEmi><cStat>100</cStat><dhProc>2026-11-14T10:05:09-03:00</dhProc><nDFSe>1234567</nDFSe>` +
    `<emit><CNPJ>68153622000193</CNPJ><IM>99650737</IM><xNome>CLAUDIA TECNOLOGIA LIMITADA</xNome><enderNac><xLgr>RUA DO SOL</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>2611101</cMun><UF>PE</UF><CEP>56300000</CEP></enderNac><fone>87999990000</fone><email>contato@claudia.com.br</email></emit>` +
    `<valores><vBC>52.00</vBC><pAliqAplic>2.00</pAliqAplic><vISSQN>1.04</vISSQN><vLiq>52.00</vLiq></valores>` +
    withAmb +
    `</infNFSe></NFSe>`
  );
}

async function issuedNfse() {
  const s = await setup();
  const n = reserveDpsNumber(s.db, s.ctx, s.card);
  const dps = buildDpsXml(nfseDraftForCard(s.db, s.card, { today: new Date("2026-11-14T12:00:00Z") }), { environment: "producao", issuedAt: new Date("2026-11-14T13:00:00Z"), ...n, appVersion: "ConectCRM 0.2.111" });
  const xml = nfseFromDps(dps);
  markNfseIssued(s.db, s.ctx, s.card, { accessKey: KEY, number: "126", environment: "producao", nfseXml: xml, via: "api" });
  return { ...s, xml, dps };
}

describe("NFS-e B4 — pedido de cancelamento", () => {
  const base = { accessKey: KEY, cnpj: "68.153.622/0001-93", environment: "producao" as const, code: 1 as const, reason: "Valor do serviço informado errado", at: new Date("2026-11-15T12:00:00Z"), appVersion: "ConectCRM 0.2.111" };

  it.skipIf(!hasXmllint)("XML válido no esquema oficial (pedRegEvento v1.01)", () => {
    const xml = buildCancelEventXml(base);
    expect(validate(xml, XSD_EVT)).toBe("");
    expect(xml).toContain(`<infPedReg Id="PRE${KEY}101101">`);
    expect(xml).toContain("<tpAmb>1</tpAmb>");
    expect(xml).toContain("<dhEvento>2026-11-15T09:00:00-03:00</dhEvento>");
    expect(xml).toContain("<CNPJAutor>68153622000193</CNPJAutor>");
    expect(xml).toContain("<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Valor do serviço informado errado</xMotivo></e101101>");
    expect(xml).not.toMatch(/<\w+:/);
    const rest = buildCancelEventXml({ ...base, environment: "producao_restrita", code: 9, reason: "Teste  de\ncancelamento & <outros>" });
    expect(validate(rest, XSD_EVT)).toBe("");
    expect(rest).toContain("<tpAmb>2</tpAmb>");
    expect(rest).toContain("<xMotivo>Teste de cancelamento &amp; &lt;outros&gt;</xMotivo>");
  });

  it("Id com 59 caracteres e validações do motivo", () => {
    expect(cancelEventId(KEY)).toHaveLength(59);
    expect(cancelInputError(3, "x".repeat(20))).toMatch(/motivo/);
    expect(cancelInputError(2, "curto")).toMatch(/15/);
    expect(cancelInputError(2, "x".repeat(256))).toMatch(/255/);
    expect(cancelInputError(2, "  serviço não foi prestado  ")).toBeNull();
    expect(() => buildCancelEventXml({ ...base, accessKey: "123" })).toThrow(/Chave/);
    expect(() => buildCancelEventXml({ ...base, reason: "curto" })).toThrow(/15/);
  });
});

describe("NFS-e B4 — cancelamento no cartão e nova nota", () => {
  it("cancelada pela API: guarda o evento, nota no histórico e trava nova emissão até preparar outra", async () => {
    const { db, ctx, card } = await issuedNfse();
    expect(() => markNfseCanceled(db, ctx, card, { accessKey: "1".repeat(50), code: 1, reason: "x", eventXml: "<evento/>" })).toThrow(/chave/);
    expect(() => markNfseCanceled(db, ctx, card, { accessKey: KEY, code: 5, reason: "x", eventXml: "<evento/>" })).toThrow(/Motivo/);
    markNfseCanceled(db, ctx, card, { accessKey: KEY, code: 1, reason: "Valor do serviço informado errado", eventXml: "<evento/>" });
    markNfseCanceled(db, ctx, card, { accessKey: KEY, code: 1, reason: "de novo", eventXml: "<evento/>" }); // idempotente
    const d = nfseDraftForCard(db, card);
    expect(d.issued?.canceled).toMatchObject({ code: 1, reason: "Valor do serviço informado errado", via: "api" });
    expect(nfsePending(d)).toEqual([{ field: "issued", message: "NFS-e nº 126 deste cartão foi cancelada.", level: "warning" }]);
    const notes = many<{ body: string }>(db, "SELECT body FROM note WHERE entity_id = ? ORDER BY created_at", card);
    expect(notes.filter((n) => n.body.includes("cancelada"))).toHaveLength(1);
    expect(notes.at(-1)!.body).toContain("NFS-e nº 126 cancelada pela API do Emissor Nacional");
    expect(notes.at(-1)!.body).toContain("Motivo: Erro na emissão — Valor do serviço informado errado");
    expect(() => reserveDpsNumber(db, ctx, card)).toThrow(/já foi emitida/);

    reopenNfseDraft(db, ctx, card);
    const novo = nfseDraftForCard(db, card);
    expect(novo.issued).toBeNull();
    expect(novo.texts.description).toBe("Certificado digital A1 — Caixa Escolar Prof. Hildebrando Pontes");
    expect(novo.texts.orderNumber).toBe("22627840");
    expect(reserveDpsNumber(db, ctx, card)).toEqual({ series: "1", number: 2 }); // DPS nova, número seguinte
    const rows = many<{ status: string; deleted_at: string | null; cancel_event_xml: string | null }>(db, "SELECT status, deleted_at, cancel_event_xml FROM nfse_draft WHERE card_id = ? ORDER BY created_at", card);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "issued", cancel_event_xml: "<evento/>" });
    expect(rows[0]!.deleted_at).not.toBeNull(); // a cancelada fica guardada
    expect(rows[1]).toMatchObject({ status: "draft", deleted_at: null });
  });

  it("emitida pelo portal: só registra o cancelamento feito lá; preparar outra exige cancelar antes", async () => {
    const { db, ctx, card } = await setup();
    markNfseIssued(db, ctx, card, { accessKey: KEY, number: "77", environment: "producao", via: "portal" });
    expect(() => reopenNfseDraft(db, ctx, card)).toThrow(/depois de cancelar/);
    markNfseCanceled(db, ctx, card, { accessKey: KEY });
    expect(nfseDraftForCard(db, card).issued?.canceled).toMatchObject({ via: "portal", code: null });
    const body = many<{ body: string }>(db, "SELECT body FROM note WHERE entity_id = ? ORDER BY created_at", card).at(-1)!.body;
    expect(body).toContain("NFS-e nº 77 cancelada no Emissor Nacional (registrado no ConectCRM)");
  });

  it("sem nota emitida não dá para cancelar", async () => {
    const { db, ctx, card } = await setup();
    expect(() => markNfseCanceled(db, ctx, card, { accessKey: KEY })).toThrow(/não tem NFS-e emitida/);
  });
});

describe("NFS-e B4 — DANFSe", () => {
  it("leitor de XML: entidades, CDATA, prefixos", () => {
    const r = parseXml(`<?xml version="1.0"?><a:x xmlns:a="u"><a:y k="1&amp;2">A &amp; B <![CDATA[<c>]]></a:y><z/></a:x>`);
    expect(xtext(r, "x/y")).toBe("A & B <c>");
    expect(r.children[0]!.children[0]!.attrs.k).toBe("1&2");
    expect(r.children[0]!.children[1]!.name).toBe("z");
  });

  it("formatação", () => {
    expect(brMoney("1234.5")).toBe("R$ 1.234,50");
    expect(brMoney("")).toBe("-");
    expect(brDate("2026-11-14T10:05:09-03:00", true)).toBe("14/11/2026 10:05:09");
    expect(brDoc("68153622000193")).toBe("68.153.622/0001-93");
    expect(brDoc("52998224725")).toBe("529.982.247-25");
    expect(danfseFileName("126", KEY)).toBe("DANFSe-NFS-e-126.pdf");
  });

  it("dados do DANFSe vêm do XML da NFS-e", async () => {
    const { xml } = await issuedNfse();
    const d = danfseData(xml);
    expect(d.accessKey).toBe(KEY);
    expect(d.homologacao).toBe(false);
    expect(d.municipioEmissor).toBe("Município: Petrolina / PE");
    expect(d.ambienteGerador).toBe("Sefin Nacional NFS-e");
    expect(d.ident).toMatchObject({ numero: "126", competencia: "14/11/2026", emissaoNfse: "14/11/2026 10:05:09", nDps: "1", serie: "1", emissaoDps: "14/11/2026 10:00:00", emitente: "Prestador", situacao: "NFS-e Gerada", finalidade: "NFS-e regular" });
    expect(d.prestador).toMatchObject({ doc: "68.153.622/0001-93", im: "99650737", nome: "CLAUDIA TECNOLOGIA LIMITADA", cityUf: "Petrolina / PE", ibgeCep: "2611101 / 56.300-000", endereco: "RUA DO SOL, 10, CENTRO", simples: "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)" });
    expect(d.prestador.regimeSN).toMatch(/^Regime de apuração dos tributos federais e municipal pelo Simples/);
    expect(d.tomador).toMatchObject({ doc: "19.929.587/0001-46", nome: "CAIXA ESCOLAR PROFESSOR HILDEBRANDO PONTES", cityUf: "Uberaba / MG", ibgeCep: "3170107 / 38.067-230", endereco: "PRACA ANTONIO DELFINO, 53, FABRICIO", email: "escola.160059@educacao.mg.gov.br", im: "-", fone: "-" });
    expect(d.intermediario).toBeNull();
    expect(d.servico).toMatchObject({ codigo: "01.09.01", nbs: "1.1503.00.00", local: "Petrolina / PE / Brasil", descricao: "Certificado digital A1 — Caixa Escolar Prof. Hildebrando Pontes" });
    expect(d.issqn).toMatchObject({ tipo: "Operação Tributável", incidencia: "Petrolina / PE / Brasil", regimeEspecial: "Nenhum", bc: "R$ 52,00", aliquota: "2,00%", retencao: "Não Retido", apurado: "R$ 1,04", calculoBM: "-" });
    expect(d.federal).toMatchObject({ irrf: "-", cp: "-", contribSociais: "-", showPisCofins: true });
    expect(d.ibscbs).toBeNull();
    expect(d.totais).toMatchObject({ servico: "R$ 52,00", liquido: "R$ 52,00", ibsCbs: "-", liquidoIbsCbs: "R$ 52,00" });
    expect(d.infoCompl).toBe("Pedido: 22627840\nProcesso de compra 22627840\nTotais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Simples Nacional: 6,00%");
  });

  it("PDF de uma página A4, com QR Code, cancelada e homologação", async () => {
    const { dps } = await issuedNfse();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const textOf = async (bytes: Uint8Array) => {
      const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true }).promise;
      expect(doc.numPages).toBe(1);
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      expect([Math.round(vp.width), Math.round(vp.height)]).toEqual([595, 842]);
      return (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("|");
    };
    const logo = readFileSync(resolve(__dirname, "../public/nfse-logo.png"));
    const normal = await buildDanfsePdf(nfseFromDps(dps), { logoPng: logo });
    if (process.env.DANFSE_OUT) {
      const { writeFileSync: w } = await import("node:fs");
      w(`${process.env.DANFSE_OUT}/normal.pdf`, normal);
      w(`${process.env.DANFSE_OUT}/cancelada.pdf`, await buildDanfsePdf(nfseFromDps(dps, { tpAmb: 2 }), { logoPng: logo, canceled: true }));
    }
    expect(new TextDecoder().decode(normal.slice(0, 5))).toBe("%PDF-");
    const t = await textOf(normal);
    for (const s of ["DANFSe v2.0", "Documento Auxiliar da NFS-e", KEY, "CLAUDIA TECNOLOGIA LIMITADA", "CAIXA ESCOLAR PROFESSOR HILDEBRANDO PONTES", "R$ 52,00", "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", "Simples Nacional: 6,00%"])
      expect(t).toContain(s);
    expect(t).not.toContain("CANCELADA");
    expect(t).not.toContain("SEM VALIDADE");

    const cancelada = await textOf(await buildDanfsePdf(nfseFromDps(dps), { canceled: true }));
    expect(cancelada).toContain("CANCELADA");
    const homolog = await textOf(await buildDanfsePdf(nfseFromDps(dps, { tpAmb: 2 })));
    expect(homolog).toContain("NFS-e SEM VALIDADE JURÍDICA");

    // Descrição e informações enormes continuam numa página só.
    const big = nfseFromDps(dps).replace(/<xDescServ>[^<]*<\/xDescServ>/, `<xDescServ>${"Serviço muito detalhado ".repeat(60)}</xDescServ>`).replace(/<xInfComp>[^<]*<\/xInfComp>/, `<xInfComp>${"Observação longa ".repeat(150)}</xInfComp>`);
    await textOf(await buildDanfsePdf(big));
  });

  it("rejeita XML que não é NFS-e", () => {
    expect(() => danfseData("<DPS/>")).toThrow(/NFS-e/);
  });
});

describe("NFS-e B5 — teste de conexão", () => {
  it("chave de teste com 50 dígitos da própria empresa", async () => {
    const { probeAccessKey } = await import("../src/lib/nfse/fiscal");
    const k = probeAccessKey("2611101", "68.153.622/0001-93", new Date(2026, 10, 14));
    expect(k).toMatch(/^\d{50}$/);
    expect(k).toBe("2611101" + "22" + "68153622000193" + "0".repeat(13) + "2611" + "0".repeat(10));
  });
  it("classifica a resposta", async () => {
    const { classifyProbe } = await import("../src/lib/nfse/fiscal");
    expect(classifyProbe({ httpStatus: 404 }).ok).toBe(true);
    expect(classifyProbe({ httpStatus: 400, body: { erros: [{ codigo: "E999", descricao: "Chave inválida" }] } }).ok).toBe(true);
    const r = classifyProbe({ httpStatus: 401, body: { erro: { codigo: "E1200", descricao: "Certificado de Transmissão Inválido" } } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("E1200");
    expect(classifyProbe({ httpStatus: 503, text: "fora" }).ok).toBe(false);
  });
});

describe("NFS-e B5 — mensagens do Native Messaging", () => {
  it("programa ausente × programa que fechou sozinho", async () => {
    const mod = await import("../src/lib/nfse/fiscal");
    const send = (msg: string) => {
      (globalThis as unknown as { chrome: unknown }).chrome = {
        runtime: {
          lastError: undefined as unknown,
          sendNativeMessage(_h: string, _m: unknown, cb: (r: unknown) => void) {
            (this as { lastError: unknown }).lastError = { message: msg };
            cb(undefined);
          },
        },
      };
      return mod.fiscalCall({ cmd: "ping" });
    };
    await expect(send("Specified native messaging host not found.")).rejects.toBeInstanceOf(mod.FiscalNotInstalled);
    const e = await send("Native host has exited.").catch((x) => x);
    expect(e).toBeInstanceOf(mod.FiscalCrashed);
    expect(e.message).toContain("fechou sozinho");
    expect(e.message).toContain("%LOCALAPPDATA%\\ConectCRM\\Fiscal");
  });
});

describe("NFS-e — DANFSe guardado no cartão (GED)", () => {
  it("nome, tipo Nota fiscal, vínculos, sem duplicar e nova versão quando cancelada", async () => {
    const { danfseDocumentName, saveNfseDanfse } = await import("../src/db/nfse");
    const { db, ctx, card } = await issuedNfse();
    const d = nfseDraftForCard(db, card);
    expect(d.taker.shortName).toBe("Caixa Escolar");
    const name = danfseDocumentName("Caixa Escolar Prof. Hildebrando Pontes", 5200, "1", KEY);
    expect(name).toBe("Caixa Escolar Prof. Hildebrando Pontes - 52,00 - DANFSe-NFS-e-1");
    expect(danfseDocumentName("A/B", 123456, null, KEY)).toBe(`A_B - 1.234,56 - DANFSe-NFS-e-${KEY}`);
    const file = (n: string) => ({ sha256: n.repeat(64), mime: "application/pdf", size: 1000, filename: `${name}.pdf`, location: "browser" as const });
    const docId = saveNfseDanfse(db, ctx, card, { file: file("a"), name, canceled: false });
    expect(saveNfseDanfse(db, ctx, card, { file: file("b"), name, canceled: false })).toBe(docId); // não duplica
    const doc = one<{ name: string; tipo: string; doc_date: string }>(db, "SELECT d.name, t.name AS tipo, d.doc_date FROM document d JOIN document_type t ON t.id = d.type_id WHERE d.id = ?", docId)!;
    expect(doc).toMatchObject({ name, tipo: "Nota fiscal" });
    const links = many<{ entity_type: string }>(db, "SELECT entity_type FROM document_link WHERE document_id = ? AND deleted_at IS NULL ORDER BY entity_type", docId).map((l) => l.entity_type);
    expect(links).toEqual(["deal", "organization"]);
    expect(nfseDraftForCard(db, card).issued?.danfse).toEqual({ documentId: docId, canceled: false });
    // Cancelada depois: nova versão (com a marca), uma vez só.
    markNfseCanceled(db, ctx, card, { accessKey: KEY, code: 1, reason: "Valor do serviço informado errado", eventXml: "<evento/>" });
    expect(saveNfseDanfse(db, ctx, card, { file: file("c"), name, canceled: true })).toBe(docId);
    saveNfseDanfse(db, ctx, card, { file: file("d"), name, canceled: true });
    expect(one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM document_version WHERE document_id = ?", docId)!.n).toBe(2);
    expect(nfseDraftForCard(db, card).issued?.danfse).toEqual({ documentId: docId, canceled: true });
  });

  it("sem nota emitida, não guarda", async () => {
    const { saveNfseDanfse } = await import("../src/db/nfse");
    const { db, ctx, card } = await setup();
    expect(() => saveNfseDanfse(db, ctx, card, { file: { sha256: "a".repeat(64), mime: "application/pdf", size: 1, filename: "x.pdf", location: "browser" }, name: "x", canceled: false })).toThrow(/não tem NFS-e/);
  });
});
