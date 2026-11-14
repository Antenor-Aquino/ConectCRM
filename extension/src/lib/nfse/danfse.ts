// DANFSe v2.0 (Documento Auxiliar da NFS-e) — spec 20, B4.
// A API de DANFSe do ADN foi suspensa (NT 008, 03/08/2026): o PDF é gerado aqui,
// a partir do XML da NFS-e devolvido pela Sefin, no leiaute do Anexo I da
// NT 008 v1.02 (A4 retrato, uma página, medidas em cm do item 2.4.5).
// Só imprime o que está no XML; campo vazio vira "-" (nota 12).
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import qrcode from "qrcode-generator";
import { formatNbs, formatTribNac, municipioPorIbge } from "./tabelas";

// ---------------------------------------------------------------- XML mínimo

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );
const local = (n: string) => n.slice(n.indexOf(":") + 1);

/** Leitor de XML suficiente para a NFS-e (elementos, atributos, texto, CDATA). Nomes sem prefixo. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1]!)] = decode(a[2] ?? a[3] ?? "");
      const node: XNode = { name: local(m[3]), attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decode(m[6]);
  }
  return root;
}

/** Nó pelo caminho "a/b/c" (nomes locais). */
export function xnode(n: XNode | null | undefined, path: string): XNode | null {
  let cur: XNode | null | undefined = n;
  for (const part of path.split("/")) {
    if (!cur) return null;
    cur = cur.children.find((c) => c.name === part);
  }
  return cur ?? null;
}
/** Texto (aparado) pelo caminho, "" se não existir. */
export const xtext = (n: XNode | null | undefined, path: string) => xnode(n, path)?.text.trim() ?? "";
/** Primeiro descendente com esse nome. */
function xfind(n: XNode | null | undefined, name: string): XNode | null {
  if (!n) return null;
  for (const c of n.children) {
    if (c.name === name) return c;
    const f = xfind(c, name);
    if (f) return f;
  }
  return null;
}

// ---------------------------------------------------------------- formatação

const DASH = "-";
const or = (s: string | null | undefined) => (s && s.trim() ? s.trim() : DASH);
const num = (s: string) => (s === "" ? null : Number(s));
export function brMoney(s: string | number | null | undefined): string {
  const v = typeof s === "number" ? s : s == null || s === "" ? null : Number(s);
  if (v == null || !Number.isFinite(v)) return DASH;
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function brPct(s: string | null | undefined): string {
  if (!s) return DASH;
  const v = Number(s);
  return Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%" : DASH;
}
/** "2026-11-14" → "14/11/2026"; "2026-11-14T10:05:00-03:00" → "14/11/2026 10:05:00" (horário do próprio XML). */
export function brDate(s: string, withTime = false): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/);
  if (!m) return or(s);
  return `${m[3]}/${m[2]}/${m[1]}${withTime && m[4] ? ` ${m[4]}` : ""}`;
}
export function brDoc(s: string): string {
  const d = s.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return or(s);
}
const brCep = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 2)}.${s.slice(2, 5)}-${s.slice(5)}` : s);
const join = (parts: (string | null | undefined)[], sep = " / ") => parts.filter((p) => p && p.trim()).join(sep);

const EMITENTE: Record<string, string> = { "1": "Prestador", "2": "Tomador", "3": "Intermediário" };
const SITUACAO: Record<string, string> = { "100": "NFS-e Gerada", "101": "NFS-e de Substituição Gerada", "102": "NFS-e de Decisão Judicial", "103": "NFS-e Avulsa" };
const FINALIDADE: Record<string, string> = { "0": "NFS-e regular", "1": "NFS-e de crédito", "2": "NFS-e de débito" };
const AMB_GER: Record<string, string> = { "1": "Sistema Próprio do Município", "2": "Sefin Nacional NFS-e" };
const SIMPLES: Record<string, string> = { "1": "Não Optante", "2": "Optante - Microempreendedor Individual (MEI)", "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)" };
const REG_SN: Record<string, string> = {
  "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "2": "Regime de apuração dos tributos federais pelo SN e o ISSQN pela NFS-e conforme respectiva legislação municipal do tributo",
  "3": "Regime de apuração dos tributos federais e municipal pela NFS-e conforme respectivas legislações federal e municipal de cada tributo",
};
const TRIB_ISSQN: Record<string, string> = { "1": "Operação Tributável", "2": "Imunidade", "3": "Exportação de Serviço", "4": "Não Incidência" };
const RET_ISSQN: Record<string, string> = { "1": "Não Retido", "2": "Retido pelo Tomador", "3": "Retido pelo Intermediário" };
const REG_ESP: Record<string, string> = { "0": "Nenhum", "1": "Ato Cooperado (Cooperativa)", "2": "Estimativa", "3": "Microempresa Municipal", "4": "Notário ou Registrador", "5": "Profissional Autônomo", "6": "Sociedade de Profissionais", "9": "Outros" };
const IMUNIDADE: Record<string, string> = { "0": "Imunidade (tipo não informado)", "1": "Patrimônio, renda ou serviços uns dos outros", "2": "Templos de qualquer culto", "3": "Partidos políticos, entidades sindicais, educação e assistência social", "4": "Livros, jornais, periódicos e papel", "5": "Fonogramas e videofonogramas musicais" };
const SUSPENSAO: Record<string, string> = { "1": "Decisão judicial", "2": "Processo administrativo" };
const BM: Record<string, string> = { "1": "Isenção", "2": "Redução da BC em percentual", "3": "Redução da BC em valor", "4": "Alíquota diferenciada" };
const RET_PISCOFINS: Record<string, { label: string; ret: string }> = {
  "0": { label: "PIS/COFINS/CSLL Não Retidos", ret: "" },
  "1": { label: "PIS/COFINS Retidos", ret: "PC" },
  "2": { label: "PIS/COFINS Não Retidos", ret: "" },
  "3": { label: "PIS/COFINS/CSLL Retidos", ret: "PCS" },
  "4": { label: "PIS/COFINS Retidos, CSLL Não Retido", ret: "PC" },
  "5": { label: "PIS Retido, COFINS/CSLL Não Retido", ret: "P" },
  "6": { label: "COFINS Retido, PIS/CSLL Não Retido", ret: "C" },
  "7": { label: "PIS Não Retido, COFINS/CSLL Retidos", ret: "CS" },
  "8": { label: "PIS/COFINS Não Retidos, CSLL Retido", ret: "S" },
  "9": { label: "COFINS Não Retido, PIS/CSLL Retidos", ret: "PS" },
};

function cityUf(ibge: string, nome?: string, uf?: string): string {
  const m = ibge ? municipioPorIbge(ibge) : null;
  return join([nome || m?.nome, uf || m?.uf]);
}

// ---------------------------------------------------------------- dados

interface Party {
  doc: string;
  im: string;
  fone: string;
  nome: string;
  cityUf: string;
  ibgeCep: string;
  endereco: string;
  email: string;
}

export interface DanfseData {
  accessKey: string;
  homologacao: boolean;
  municipioEmissor: string;
  ambienteGerador: string;
  tipoAmbiente: string;
  ident: { numero: string; competencia: string; emissaoNfse: string; nDps: string; serie: string; emissaoDps: string; emitente: string; situacao: string; finalidade: string };
  prestador: Party & { simples: string; regimeSN: string };
  tomador: Party | null;
  intermediario: Party | null;
  servico: { codigo: string; nbs: string; local: string; descCodigo: string; descricao: string };
  issqn: null | {
    tipo: string;
    incidencia: string;
    regimeEspecial: string;
    imunidade: string;
    suspensao: string;
    processo: string;
    beneficio: string;
    calculoBM: string;
    deducoes: string;
    descontoIncond: string;
    bc: string;
    aliquota: string;
    retencao: string;
    apurado: string;
  };
  issqnNaoSujeito: boolean;
  federal: { irrf: string; cp: string; contribSociais: string; pis: string; cofins: string; descContrib: string; showPisCofins: boolean };
  ibscbs: null | string[][];
  totais: { servico: string; descIncond: string; descCond: string; retencoes: string; liquido: string; ibsCbs: string; liquidoIbsCbs: string };
  infoCompl: string;
}

function party(n: XNode | null, emit = false): Party | null {
  if (!n) return null;
  const doc = xtext(n, "CNPJ") || xtext(n, "CPF") || xtext(n, "NIF");
  const nome = xtext(n, "xNome");
  if (!doc && !nome) return null;
  const end = emit ? xnode(n, "enderNac") : xnode(n, "end");
  const nac = emit ? end : xnode(end, "endNac");
  const ext = emit ? null : xnode(end, "endExt");
  const ibge = xtext(nac, "cMun");
  return {
    doc: xtext(n, "NIF") && !xtext(n, "CNPJ") && !xtext(n, "CPF") ? xtext(n, "NIF") : brDoc(doc),
    im: or(xtext(n, "IM")),
    fone: or(xtext(n, "fone")),
    nome: or(nome),
    cityUf: or(ext ? join([xtext(ext, "xCidade"), xtext(ext, "xEstProvReg")]) : cityUf(ibge, undefined, emit ? xtext(nac, "UF") : undefined)),
    ibgeCep: or(ext ? join([xtext(ext, "cPais"), xtext(ext, "cEndPost")]) : join([ibge, brCep(xtext(nac, "CEP"))])),
    endereco: or(join([xtext(end, "xLgr"), xtext(end, "nro"), xtext(end, "xCpl"), xtext(end, "xBairro")], ", ")),
    email: or(xtext(n, "email")),
  };
}

/** Lê o XML da NFS-e (elemento NFSe, com ou sem declaração) para o DANFSe. */
export function danfseData(nfseXml: string): DanfseData {
  const doc = parseXml(nfseXml);
  const nfse = xfind(doc, "NFSe");
  const inf = xnode(nfse, "infNFSe");
  if (!inf) throw new Error("XML não é de uma NFS-e (falta infNFSe).");
  const dps = xnode(inf, "DPS/infDPS");
  if (!dps) throw new Error("XML da NFS-e sem a DPS.");
  const accessKey = (inf.attrs.Id ?? "").replace(/^NFS/, "");
  const tpAmb = xtext(dps, "tpAmb");

  const emitNode = xnode(inf, "emit");
  const emit = party(emitNode, true);
  const prestNode = xnode(dps, "prest");
  const regTrib = xnode(prestNode, "regTrib");
  const prestDps = party(prestNode);
  const prestador = {
    ...(emit ?? prestDps ?? { doc: DASH, im: DASH, fone: DASH, nome: DASH, cityUf: DASH, ibgeCep: DASH, endereco: DASH, email: DASH }),
    simples: or(SIMPLES[xtext(regTrib, "opSimpNac")]),
    regimeSN: or(REG_SN[xtext(regTrib, "regApTribSN")]),
  };
  if (emit && prestDps) {
    if (prestador.fone === DASH) prestador.fone = prestDps.fone;
    if (prestador.email === DASH) prestador.email = prestDps.email;
    if (prestador.im === DASH) prestador.im = prestDps.im;
  }

  // Serviço
  const cServ = xnode(dps, "serv/cServ");
  const locPrest = xnode(dps, "serv/locPrest");
  const cLoc = xtext(locPrest, "cLocPrestacao");
  const pais = xtext(locPrest, "cPaisPrestacao");
  const servico = {
    codigo: or(join([xtext(cServ, "cTribNac") && formatTribNac(xtext(cServ, "cTribNac")), xtext(cServ, "cTribMun")])),
    nbs: or(xtext(cServ, "cNBS") && formatNbs(xtext(cServ, "cNBS"))),
    local: or(cLoc ? join([xtext(inf, "xLocPrestacao") || municipioPorIbge(cLoc)?.nome, municipioPorIbge(cLoc)?.uf, "Brasil"]) : join([xtext(inf, "xLocPrestacao"), pais])),
    descCodigo: or(join([xtext(inf, "xTribNac"), xtext(inf, "xTribMun")])),
    descricao: or(xtext(cServ, "xDescServ")),
  };

  // Valores
  const vals = xnode(dps, "valores");
  const vInf = xnode(inf, "valores");
  const tribMun = xnode(vals, "trib/tribMun");
  const tribISSQN = xtext(tribMun, "tribISSQN");
  const cInc = xtext(inf, "cLocIncid");
  const issqnNaoSujeito = tribISSQN !== "" && tribISSQN !== "1";
  const issqn = issqnNaoSujeito
    ? null
    : {
        tipo: or(TRIB_ISSQN[tribISSQN]),
        incidencia: or(cInc ? join([xtext(inf, "xLocIncid") || municipioPorIbge(cInc)?.nome, municipioPorIbge(cInc)?.uf, "Brasil"]) : ""),
        regimeEspecial: or(REG_ESP[xtext(regTrib, "regEspTrib")]),
        imunidade: or(IMUNIDADE[xtext(tribMun, "tpImunidade")]),
        suspensao: or(SUSPENSAO[xtext(tribMun, "exigSusp/tpSusp")]),
        processo: or(xtext(tribMun, "exigSusp/nProcesso")),
        beneficio: or(BM[xtext(vInf, "tpBM")]),
        calculoBM: brMoney(xtext(vInf, "vCalcBM")),
        deducoes: brMoney(xtext(vInf, "vCalcDR")),
        descontoIncond: brMoney(xtext(vals, "vDescCondIncond/vDescIncond")),
        bc: brMoney(xtext(vInf, "vBC")),
        aliquota: brPct(xtext(vInf, "pAliqAplic")),
        retencao: or(RET_ISSQN[xtext(tribMun, "tpRetISSQN")]),
        apurado: brMoney(xtext(vInf, "vISSQN")),
      };

  const fed = xnode(vals, "trib/tribFed");
  const pc = xnode(fed, "piscofins");
  const tpRet = RET_PISCOFINS[xtext(pc, "tpRetPisCofins")];
  const vPis = num(xtext(pc, "vPis"));
  const vCofins = num(xtext(pc, "vCofins"));
  const vCsll = num(xtext(fed, "vRetCSLL"));
  const ret = tpRet?.ret ?? "";
  const contrib = (ret.includes("P") ? (vPis ?? 0) : 0) + (ret.includes("C") ? (vCofins ?? 0) : 0) + (vCsll ?? 0);
  const anyContrib = (ret.includes("P") && vPis != null) || (ret.includes("C") && vCofins != null) || vCsll != null;
  const competencia = xtext(dps, "dCompet");
  const federal = {
    irrf: brMoney(xtext(fed, "vRetIRRF")),
    cp: brMoney(xtext(fed, "vRetCP")),
    contribSociais: anyContrib ? brMoney(contrib) : DASH,
    pis: !ret.includes("P") && vPis != null ? brMoney(vPis) : DASH,
    cofins: !ret.includes("C") && vCofins != null ? brMoney(vCofins) : DASH,
    descContrib: or(tpRet?.label),
    showPisCofins: !competencia || competencia.slice(0, 4) <= "2026",
  };

  // IBS/CBS (só quando a nota traz o grupo)
  const ib = xnode(inf, "IBSCBS");
  const ibDps = xnode(dps, "IBSCBS");
  let ibscbs: string[][] | null = null;
  let totIbsCbs: number | null = null;
  if (ib) {
    const v = xnode(ib, "valores");
    const tot = xnode(ib, "totCIBS");
    const ibs = num(xtext(tot, "gIBS/vIBSTot"));
    const cbs = num(xtext(tot, "gCBS/vCBS"));
    totIbsCbs = ibs != null || cbs != null ? (ibs ?? 0) + (cbs ?? 0) : null;
    const g = xnode(ibDps, "valores/trib/gIBSCBS");
    ibscbs = [
      ["CST / cClassTrib", or(join([xtext(g, "CST"), xtext(g, "cClassTrib")]))],
      ["Indicador de Operação / Código IBGE / Município / UF", or(join([xtext(ibDps, "cIndOp"), xtext(ib, "cLocalidadeIncid"), xtext(ib, "xLocalidadeIncid") || cityUf(xtext(ib, "cLocalidadeIncid"))]))],
      ["Exclusões e Reduções da Base de Cálculo", brMoney(xtext(v, "vCalcReeRepRes"))],
      ["Base de Cálculo Após Exclusões e Reduções", brMoney(xtext(v, "vBC"))],
      ["Red. Alíquota IBS / Red. Alíquota CBS", or(join([brPct(xtext(v, "uf/pRedAliqUF")), brPct(xtext(v, "mun/pRedAliqMun")), brPct(xtext(v, "fed/pRedAliqCBS"))]))],
      ["Alíquota - IBS UF / IBS Mun", or(join([brPct(xtext(v, "uf/pIBSUF")), brPct(xtext(v, "mun/pIBSMun"))]))],
      ["Alíq. Efetiva Municipal - IBS", brPct(xtext(v, "mun/pAliqEfetMun"))],
      ["Valor Apurado Municipal - IBS", brMoney(xtext(tot, "gIBS/gIBSMunTot/vIBSMun"))],
      ["Alíq. Efetiva Estadual - IBS", brPct(xtext(v, "uf/pAliqEfetUF"))],
      ["Valor Apurado Estadual - IBS", brMoney(xtext(tot, "gIBS/gIBSUFTot/vIBSUF"))],
      ["Valor Total Apurado - IBS", brMoney(ibs)],
      ["Alíquota - CBS", brPct(xtext(v, "fed/pCBS"))],
      ["Alíquota Efetiva - CBS", brPct(xtext(v, "fed/pAliqEfetCBS"))],
      ["Valor Total Apurado - CBS", brMoney(cbs)],
    ];
  }
  const vLiq = num(xtext(vInf, "vLiq"));
  const totais = {
    servico: brMoney(xtext(vals, "vServPrest/vServ")),
    descIncond: brMoney(xtext(vals, "vDescCondIncond/vDescIncond")),
    descCond: brMoney(xtext(vals, "vDescCondIncond/vDescCond")),
    retencoes: brMoney(xtext(vInf, "vTotalRet")),
    liquido: brMoney(vLiq),
    ibsCbs: brMoney(totIbsCbs),
    liquidoIbsCbs: brMoney(ib && xtext(ib, "totCIBS/vTotNF") ? xtext(ib, "totCIBS/vTotNF") : vLiq != null ? vLiq + (totIbsCbs ?? 0) : null),
  };

  // Informações complementares
  const info: string[] = [];
  const sub = xtext(dps, "subst/chSubstda");
  if (sub) info.push(`NFS-e Subst.: ${sub}`);
  const obra = xnode(dps, "serv/obra");
  if (xtext(obra, "cObra")) info.push(`Cod. Obra: ${xtext(obra, "cObra")}`);
  const imob = xtext(obra, "inscImobFisc") || xtext(ibDps, "imovel/inscImobFisc");
  if (imob) info.push(`Insc. Imob.: ${imob}`);
  const evt = xtext(dps, "serv/atvEvento/idAtvEvt");
  if (evt) info.push(`Cod. Evt.: ${evt}`);
  const ped = xtext(dps, "serv/infoCompl/xPed");
  if (ped) info.push(`Pedido: ${ped}`);
  const comp = xtext(dps, "serv/infoCompl/xInfComp");
  if (comp) info.push(comp);
  const outInf = xtext(inf, "xOutInf");
  if (outInf) info.push(outInf);
  const totTrib = xnode(vals, "trib/totTrib");
  const lei = "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012:";
  if (xnode(totTrib, "vTotTrib"))
    info.push(`${lei} Federais: ${brMoney(xtext(totTrib, "vTotTrib/vTotTribFed"))}; Estaduais: ${brMoney(xtext(totTrib, "vTotTrib/vTotTribEst"))}; Municipais: ${brMoney(xtext(totTrib, "vTotTrib/vTotTribMun"))}`);
  else if (xnode(totTrib, "pTotTrib"))
    info.push(`${lei} Federais: ${brPct(xtext(totTrib, "pTotTrib/pTotTribFed"))}; Estaduais: ${brPct(xtext(totTrib, "pTotTrib/pTotTribEst"))}; Municipais: ${brPct(xtext(totTrib, "pTotTrib/pTotTribMun"))}`);
  else if (xtext(totTrib, "pTotTribSN")) info.push(`${lei} Simples Nacional: ${brPct(xtext(totTrib, "pTotTribSN"))}`);

  const emitUf = xtext(emitNode, "enderNac/UF");
  const cTrib = xtext(cServ, "cTribNac");
  return {
    accessKey,
    homologacao: tpAmb === "2",
    municipioEmissor: cTrib.startsWith("99") ? "" : `Município: ${join([xtext(inf, "xLocEmi"), emitUf])}`,
    ambienteGerador: or(AMB_GER[xtext(inf, "ambGer")]),
    tipoAmbiente: tpAmb === "2" ? "Produção Restrita (Homologação)" : "Produção",
    ident: {
      numero: or(xtext(inf, "nNFSe")),
      competencia: competencia ? brDate(competencia) : DASH,
      emissaoNfse: xtext(inf, "dhProc") ? brDate(xtext(inf, "dhProc"), true) : DASH,
      nDps: or(xtext(dps, "nDPS")),
      serie: or(xtext(dps, "serie")),
      emissaoDps: xtext(dps, "dhEmi") ? brDate(xtext(dps, "dhEmi"), true) : DASH,
      emitente: or(EMITENTE[xtext(dps, "tpEmit")]),
      situacao: or(SITUACAO[xtext(inf, "cStat")] ?? xtext(inf, "cStat")),
      // Leiaute da reforma (NT 009): finNFSe em infDPS; no anterior, dentro de IBSCBS.
      finalidade: or(FINALIDADE[xtext(dps, "finNFSe") || xtext(ibDps, "finNFSe")] ?? (ibDps ? "" : "NFS-e regular")),
    },
    prestador,
    tomador: party(xnode(dps, "toma")),
    intermediario: party(xnode(dps, "interm")),
    servico,
    issqn,
    issqnNaoSujeito,
    federal,
    ibscbs,
    totais,
    infoCompl: info.join("\n"),
  };
}

// ---------------------------------------------------------------- PDF

const CM = 72 / 2.54;
const PAGE_W = 21 * CM;
const PAGE_H = 29.7 * CM;
const X0 = 0.3;
const W = 20.4;
const COL = [0.3, 5.4, 10.5, 15.6] as const;
const CW = 5.1;
const CW2 = 10.2;
const SHADE = rgb(0.95, 0.95, 0.95); // cinza claro 5%
const BLACK = rgb(0, 0, 0);
const RED = rgb(1, 0, 0);

/** Caracteres que a fonte padrão do PDF (WinAnsi) não tem viram "?". */
const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const pdfSafe = (s: string) =>
  s.replace(/[\t\r]/g, " ").replace(/[^\n -~ -ÿ]/g, (c) => (WIN_EXTRA.includes(c) ? c : "?"));

class Painter {
  constructor(
    readonly page: PDFPage,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {}

  rect(x: number, y: number, w: number, h: number, shade = false, thickness = 0.5) {
    this.page.drawRectangle({ x: x * CM, y: PAGE_H - (y + h) * CM, width: w * CM, height: h * CM, borderColor: BLACK, borderWidth: thickness, color: shade ? SHADE : undefined });
  }

  /** Texto numa linha; corta com "..." se não couber em `maxW` (cm). `y` = linha de base em cm a partir do topo. */
  text(s: string, x: number, y: number, size: number, opts: { bold?: boolean; maxW?: number; align?: "left" | "center" | "right"; color?: ReturnType<typeof rgb> } = {}) {
    const font = opts.bold ? this.bold : this.regular;
    let t = pdfSafe(s).replace(/\n/g, " ");
    if (opts.maxW) t = fit(t, font, size, opts.maxW * CM);
    const tw = font.widthOfTextAtSize(t, size) / CM;
    const dx = opts.align === "center" && opts.maxW ? (opts.maxW - tw) / 2 : opts.align === "right" && opts.maxW ? opts.maxW - tw : 0;
    this.page.drawText(t, { x: (x + dx) * CM, y: PAGE_H - y * CM, size, font, color: opts.color ?? BLACK });
  }

  /** Campo: rótulo (6 pt negrito) em cima e conteúdo (7 pt) embaixo. */
  field(x: number, y: number, w: number, h: number, label: string, value: string, opts: { shade?: boolean; identLabel?: boolean } = {}) {
    this.rect(x, y, w, h, opts.shade);
    this.text(label, x + 0.08, y + 0.25, opts.identLabel ? 7 : 6, { bold: true, maxW: w - 0.16 });
    this.text(value || DASH, x + 0.08, y + h - 0.12, 7, { maxW: w - 0.16 });
  }

  /** Título do bloco (7 pt negrito, caixa alta, sombreado). */
  title(x: number, y: number, w: number, h: number, label: string, upper = true) {
    this.rect(x, y, w, h, true);
    this.text(upper ? label.toUpperCase() : label, x + 0.08, y + h / 2 + 0.09, 7, { bold: true, maxW: w - 0.16 });
  }

  /** Caixa de texto livre com várias linhas; devolve quantas linhas couberam. */
  paragraph(s: string, x: number, y: number, w: number, h: number, size = 7, lead = 0.3) {
    const lines = wrap(pdfSafe(s), this.regular, size, (w - 0.16) * CM);
    const max = Math.max(0, Math.floor((h - 0.1) / lead));
    const shown = lines.slice(0, max);
    if (lines.length > max && max > 0) shown[max - 1] = fit(shown[max - 1] + " ...", this.regular, size, (w - 0.16) * CM);
    shown.forEach((l, i) => this.page.drawText(l, { x: (x + 0.08) * CM, y: PAGE_H - (y + lead * (i + 1)) * CM, size, font: this.regular }));
    return shown.length;
  }
}

function fit(t: string, font: PDFFont, size: number, maxPt: number): string {
  if (font.widthOfTextAtSize(t, size) <= maxPt) return t;
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (font.widthOfTextAtSize(t.slice(0, mid) + "...", size) <= maxPt) lo = mid;
    else hi = mid - 1;
  }
  return t.slice(0, lo).trimEnd() + "...";
}

export function wrap(text: string, font: PDFFont, size: number, maxPt: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxPt) line = tryLine;
      else {
        if (line) out.push(line);
        // palavra maior que a linha: quebra no meio
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxPt) {
          let n = w.length - 1;
          while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxPt) n--;
          out.push(w.slice(0, n));
          w = w.slice(n);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export interface DanfseOptions {
  /** Logomarca da NFS-e (PNG). Sem ela, o cabeçalho traz o texto "NFS-e". */
  logoPng?: Uint8Array | ArrayBuffer | null;
  /** Marca d'água "CANCELADA" (item 2.5.1). */
  canceled?: boolean;
}

/** PDF do DANFSe (uma página A4) a partir do XML da NFS-e. */
export async function buildDanfsePdf(nfseXml: string, opts: DanfseOptions = {}): Promise<Uint8Array> {
  const d = danfseData(nfseXml);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DANFSe ${d.ident.numero !== DASH ? `nº ${d.ident.numero}` : d.accessKey}`);
  pdf.setSubject("Documento Auxiliar da NFS-e");
  pdf.setCreator("ConectCRM");
  pdf.setProducer("ConectCRM");
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const p = new Painter(page, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold));
  let logo: PDFImage | null = null;
  if (opts.logoPng) {
    try {
      logo = await pdf.embedPng(opts.logoPng);
    } catch {
      logo = null;
    }
  }

  // Cabeçalho (sombreado)
  p.rect(X0, 0.3, W, 1.16, true);
  if (logo) {
    const s = Math.min((4.0 * CM) / logo.width, (0.85 * CM) / logo.height);
    const lw = logo.width * s;
    const lh = logo.height * s;
    page.drawImage(logo, { x: 0.49 * CM, y: PAGE_H - 0.44 * CM - (0.85 * CM + lh) / 2, width: lw, height: lh });
  } else p.text("NFS-e", 0.49, 1.05, 16, { bold: true });
  p.text("DANFSe v2.0", 5.41, d.homologacao ? 0.68 : 0.78, 9, { bold: true, maxW: CW2, align: "center" });
  p.text("Documento Auxiliar da NFS-e", 5.41, d.homologacao ? 1.0 : 1.12, 9, { bold: true, maxW: CW2, align: "center" });
  if (d.homologacao) p.text("NFS-e SEM VALIDADE JURÍDICA", 5.41, 1.33, 9, { bold: true, maxW: CW2, align: "center", color: RED });
  if (d.municipioEmissor) p.text(d.municipioEmissor, 15.62, 0.68, 8, { maxW: 5.0 });
  p.text(`Ambiente gerador: ${d.ambienteGerador}`, 15.62, 1.05, 6, { maxW: 5.0 });
  p.text(`Tipo de ambiente: ${d.tipoAmbiente}`, 15.62, 1.32, 6, { maxW: 5.0 });

  // Dados da NFS-e
  p.rect(X0, 1.48, W, 2.86);
  p.rect(X0, 1.48, 15.3, 0.79);
  p.text("CHAVE DE ACESSO DA NFS-E", X0 + 0.08, 1.75, 7, { bold: true });
  p.text(d.accessKey || DASH, X0 + 0.08, 2.15, 9, { maxW: 15.1 });
  const id = d.ident;
  const ir = [
    [
      ["NÚMERO DA NFS-E", id.numero],
      ["COMPETÊNCIA DA NFS-E", id.competencia],
      ["DATA E HORA DA EMISSÃO DA NFS-E", id.emissaoNfse],
    ],
    [
      ["NÚMERO DA DPS", id.nDps],
      ["SÉRIE DA DPS", id.serie],
      ["DATA E HORA DA EMISSÃO DA DPS", id.emissaoDps],
    ],
    [
      ["EMITENTE DA NFS-E", id.emitente],
      ["SITUAÇÃO DA NFS-E", id.situacao],
      ["FINALIDADE", id.finalidade],
    ],
  ];
  ir.forEach((row, r) =>
    row.forEach(([label, value], c) => p.field(COL[c]!, 2.27 + r * 0.69, CW, 0.69, label!, value!, { identLabel: true, shade: r === 2 && c === 0 })),
  );
  // QR Code
  const qr = qrcode(0, "M");
  qr.addData(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${d.accessKey}`);
  qr.make();
  const n = qr.getModuleCount();
  const size = 1.62; // ≥ 1,52 cm
  const cell = size / n;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c)) page.drawRectangle({ x: (17.48 + c * cell) * CM, y: PAGE_H - (1.62 + (r + 1) * cell) * CM, width: cell * CM + 0.15, height: cell * CM + 0.15, color: BLACK });
  ["A autenticidade desta NFS-e pode ser verificada", "pela leitura deste código QR ou pela consulta da", "chave de acesso no portal nacional da NFS-e"].forEach((l, i) =>
    p.text(l, 15.8, 3.5 + i * 0.24, 6, { maxW: 4.72, align: "center" }),
  );

  let y = 4.34;
  const R = 0.64;
  const partyBlock = (title: string, pt: (Party & { simples?: string; regimeSN?: string }) | null, missing: string, withIm = true) => {
    if (!pt) {
      p.title(X0, y, W, 0.4, missing, false);
      y += 0.4;
      return;
    }
    p.title(COL[0], y, CW, R, title);
    p.field(COL[1], y, CW, R, "CNPJ / CPF / NIF", pt.doc);
    if (withIm) p.field(COL[2], y, CW, R, "Indicador Municipal (Inscrição)", pt.im);
    else p.rect(COL[2], y, CW, R);
    p.field(COL[3], y, CW, R, "Telefone", pt.fone);
    y += R;
    p.field(COL[0], y, CW2, R, "Nome / Nome Empresarial", pt.nome);
    p.field(COL[2], y, CW, R, "Município / Sigla UF", pt.cityUf);
    p.field(COL[3], y, CW, R, "Código IBGE / CEP", pt.ibgeCep);
    y += R;
    p.field(COL[0], y, CW2, R, "Endereço", pt.endereco);
    p.field(COL[2], y, CW2, R, "E-mail", pt.email);
    y += R;
    if (pt.simples !== undefined) {
      p.field(COL[0], y, CW, R, "Simples Nacional na Data de Competência", pt.simples);
      p.field(COL[1], y, 15.3, R, "Regime de Apuração Tributária pelo SN", pt.regimeSN ?? DASH);
      y += R;
    }
  };
  partyBlock("Prestador / Fornecedor", d.prestador, "");
  partyBlock("Tomador / Adquirente", d.tomador, "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");
  p.title(X0, y, W, 0.4, "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", false);
  y += 0.4;
  partyBlock("Intermediário da Operação", d.intermediario, "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e");

  // Serviço prestado — a descrição fica com a altura que precisar (até um limite)
  p.title(COL[0], y, CW, R, "Serviço Prestado");
  p.field(COL[1], y, CW, R, "Código de Tributação Nacional / Municipal", d.servico.codigo);
  p.field(COL[2], y, CW, R, "Código da NBS", d.servico.nbs);
  p.field(COL[3], y, CW, R, "Local da Prestação / Sigla UF / País", d.servico.local);
  y += R;
  p.rect(X0, y, W, 0.4);
  const dcLabel = "Descrição do Código de Tributação Nacional / Municipal:";
  const dcW = p.bold.widthOfTextAtSize(dcLabel, 6) / CM + 0.2;
  p.text(dcLabel, X0 + 0.08, y + 0.28, 6, { bold: true });
  p.text(d.servico.descCodigo, X0 + 0.08 + dcW, y + 0.28, 7, { maxW: W - dcW - 0.16 });
  y += 0.4;

  // Altura dos blocos abaixo da descrição, para dividir o espaço que sobra.
  const issH = d.issqnNaoSujeito ? 0.4 : R * 4;
  const fedH = R * (d.federal.showPisCofins ? 2 : 1);
  const ibsH = d.ibscbs ? R * 5 : 0;
  const totH = 0.69 * 2;
  const bottom = 29.4;
  const free = bottom - y - issH - fedH - ibsH - totH - 0.4; // 0,4 = título das informações complementares
  const descLines = wrap(pdfSafe(d.servico.descricao), p.regular, 7, (W - 0.16) * CM).length;
  const infoLines = wrap(pdfSafe(d.infoCompl || DASH), p.regular, 7, (W - 0.16) * CM).length;
  const lead = 0.3;
  const want = (lines: number) => 0.35 + lead * lines + 0.1;
  let descH = Math.max(1.2, want(descLines));
  const infoMin = Math.max(1.0, Math.min(want(infoLines), 4));
  if (descH > free - infoMin) descH = Math.max(1.2, free - infoMin);
  p.rect(X0, y, W, descH);
  p.text("Descrição do Serviço", X0 + 0.08, y + 0.25, 6, { bold: true });
  p.paragraph(d.servico.descricao, X0, y + 0.25, W, descH - 0.25);
  y += descH;

  // Tributação municipal
  if (d.issqnNaoSujeito || !d.issqn) {
    p.title(X0, y, W, 0.4, "TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN", false);
    y += 0.4;
  } else {
    const s = d.issqn;
    p.title(COL[0], y, CW, R, "Tributação Municipal (ISSQN)");
    p.field(COL[1], y, CW, R, "Tipo de Tributação do ISSQN", s.tipo);
    p.field(COL[2], y, CW2, R, "Município / Sigla UF / País de Incidência do ISSQN", s.incidencia);
    y += R;
    p.field(COL[0], y, CW, R, "Regime Especial de Tributação", s.regimeEspecial);
    p.field(COL[1], y, CW, R, "Tipo de Imunidade", s.imunidade);
    p.field(COL[2], y, CW, R, "Suspensão da Exigibilidade do ISSQN", s.suspensao);
    p.field(COL[3], y, CW, R, "Número Processo Suspensão", s.processo);
    y += R;
    p.field(COL[0], y, CW, R, "Benefício Municipal", s.beneficio);
    p.field(COL[1], y, CW, R, "Cálculo do BM", s.calculoBM);
    p.field(COL[2], y, CW, R, "Total Deduções/Reduções", s.deducoes);
    p.field(COL[3], y, CW, R, "Desconto Incondicionado", s.descontoIncond);
    y += R;
    p.field(COL[0], y, CW, R, "BC ISSQN", s.bc);
    p.field(COL[1], y, CW, R, "Alíquota Aplicada", s.aliquota);
    p.field(COL[2], y, CW, R, "Retenção do ISSQN", s.retencao);
    p.field(COL[3], y, CW, R, "ISSQN Apurado", s.apurado);
    y += R;
  }

  // Tributação federal
  const f = d.federal;
  p.title(COL[0], y, CW, R, "Tributação Federal (Exceto CBS)");
  p.field(COL[1], y, CW, R, "IRRF", f.irrf);
  p.field(COL[2], y, CW, R, "Contribuição Previdenciária - Retida", f.cp);
  p.field(COL[3], y, CW, R, "Contribuições Sociais - Retidas", f.contribSociais);
  y += R;
  if (f.showPisCofins) {
    p.field(COL[0], y, CW, R, "PIS - Débito Apuração Própria", f.pis);
    p.field(COL[1], y, CW, R, "COFINS - Débito Apuração Própria", f.cofins);
    p.field(COL[2], y, CW2, R, "Descrição Contrib. Sociais - Retidas", f.descContrib);
    y += R;
  }

  // IBS / CBS
  if (d.ibscbs) {
    const items = d.ibscbs;
    p.title(COL[0], y, CW, R, "Tributação IBS / CBS");
    p.field(COL[1], y, CW, R, items[0]![0]!, items[0]![1]!);
    p.field(COL[2], y, CW2, R, items[1]![0]!, items[1]![1]!);
    y += R;
    for (let i = 2; i < items.length; i += 4) {
      items.slice(i, i + 4).forEach(([label, value], c) => p.field(COL[c]!, y, CW, R, label!, value!));
      y += R;
    }
  }

  // Valor total
  const t = d.totais;
  const TR = 0.69;
  p.title(COL[0], y, CW, TR, "Valor Total da NFS-e");
  p.field(COL[1], y, CW, TR, "Valor da Operação / Serviço", t.servico);
  p.field(COL[2], y, CW, TR, "Desconto Incondicionado", t.descIncond);
  p.field(COL[3], y, CW, TR, "Desconto Condicionado", t.descCond);
  y += TR;
  p.field(COL[0], y, CW, TR, "Total das Retenções (ISSQN / Federais)", t.retencoes);
  p.field(COL[1], y, CW, TR, "Valor Líquido da NFS-e", t.liquido);
  p.field(COL[2], y, CW, TR, "Total do IBS/CBS", t.ibsCbs);
  p.field(COL[3], y, CW, TR, "Valor Líquido da NFS-e + IBS/CBS", t.liquidoIbsCbs, { shade: true });
  y += TR;

  // Informações complementares (até o fim da página)
  p.title(X0, y, W, 0.4, "Informações Complementares");
  y += 0.4;
  p.rect(X0, y, W, bottom - y);
  p.paragraph(d.infoCompl || DASH, X0, y, W, bottom - y);

  // Borda da página (1 pt)
  p.rect(X0, 0.3, W, bottom - 0.3, false, 1);

  if (opts.canceled) {
    const font = p.bold;
    const text = "CANCELADA";
    const sz = 90;
    const tw = font.widthOfTextAtSize(text, sz);
    const a = Math.PI / 4;
    page.drawText(text, {
      x: PAGE_W / 2 - (Math.cos(a) * tw) / 2 + (Math.sin(a) * sz * 0.35),
      y: PAGE_H / 2 - (Math.sin(a) * tw) / 2 - (Math.cos(a) * sz * 0.35),
      size: sz,
      font: p.regular,
      color: rgb(0.65, 0.65, 0.65),
      opacity: 0.55,
      rotate: degrees(45),
    });
  }
  return pdf.save();
}

/** Nome do arquivo do PDF. */
export const danfseFileName = (number: string | null | undefined, accessKey: string) => `DANFSe-${number ? `NFS-e-${number}` : accessKey}.pdf`;
