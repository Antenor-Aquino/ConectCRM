// DPS (Declaração de Prestação de Serviço) da NFS-e Nacional — spec 20, B1.
// Monta o XML v1.01 (sem assinatura) a partir do rascunho do cartão, na ordem
// do esquema oficial (DPS_v1.01.xsd). O ConectCRM Fiscal assina infDPS e envia.
// Sem prefixo de namespace (regra E1228).
import type { NfseDraft, NfseEnvironment } from "../../db/nfse";

export const DPS_NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
export const DPS_VERSION = "1.01";

export interface DpsOptions {
  environment: NfseEnvironment;
  /** Momento da emissão (vai em dhEmi, no horário de Brasília). */
  issuedAt: Date;
  series: string;
  number: number;
  appVersion: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const money = (cents: number) => (Math.round(cents) / 100).toFixed(2);
const pct = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
/** Texto limpo para o XML: sem caracteres de controle, espaços nas pontas aparados, no máximo `max`. */
const text = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);

/** "2026-11-14T10:05:00-03:00" — horário de Brasília (sem horário de verão). */
export function brasiliaDateTime(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** Id da DPS: "DPS" + município emissor (7) + tipo de inscrição (2 = CNPJ) + CNPJ (14) + série (5) + número (15). */
export function dpsId(cityIbge: string, cnpj: string, series: string, number: number): string {
  return `DPS${cityIbge}2${digits(cnpj).padStart(14, "0")}${series.padStart(5, "0")}${String(number).padStart(15, "0")}`;
}

function el(name: string, value: string | null | undefined): string {
  return value == null || value === "" ? "" : `<${name}>${esc(value)}</${name}>`;
}

/** XML da DPS (sem assinatura). Lança erro se faltar algo que o rascunho deveria ter garantido. */
export function buildDpsXml(d: NfseDraft, o: DpsOptions): string {
  const issuer = d.issuer;
  if (!issuer) throw new Error("Escolha a empresa emissora.");
  if (!issuer.city_ibge) throw new Error("A empresa emissora está sem município.");
  if (issuer.simples === 2) throw new Error("Emissão de MEI pela API ainda não é suportada pelo ConectCRM.");
  if (issuer.simples === 3 && issuer.simples_rate == null) throw new Error("Informe a alíquota do Simples Nacional da empresa (Configurações → Nota fiscal).");
  const s = d.services[0];
  if (!s?.tribNac) throw new Error("Serviço sem código de tributação nacional.");
  if (!d.placeIbge) throw new Error("Sem local da prestação.");
  const t = d.taker;
  const total = d.services.reduce((n, x) => n + x.valueCents, 0);
  const id = dpsId(issuer.city_ibge, issuer.cnpj, o.series, o.number);

  // Prestador (o emitente é o próprio prestador: nome e endereço vêm do cadastro nacional).
  const prest =
    `<prest><CNPJ>${digits(issuer.cnpj)}</CNPJ>${el("IM", issuer.municipal_reg)}` +
    `<regTrib><opSimpNac>${issuer.simples}</opSimpNac>${issuer.simples === 3 ? `<regApTribSN>${issuer.simples_regime}</regApTribSN>` : ""}<regEspTrib>${issuer.special_regime}</regEspTrib></regTrib></prest>`;

  // Tomador
  let toma = "";
  if (t.kind && digits(t.document)) {
    const doc = digits(t.document);
    const a = t.address;
    const end =
      a && a.cityIbge && digits(a.cep).length === 8 && a.street && a.number && a.district
        ? `<end><endNac><cMun>${a.cityIbge}</cMun><CEP>${digits(a.cep)}</CEP></endNac>${el("xLgr", text(a.street, 255))}${el("nro", text(a.number, 60))}${el("xCpl", a.complement ? text(a.complement, 156) : null)}${el("xBairro", text(a.district, 60))}</end>`
        : "";
    toma = `<toma>${doc.length === 11 ? `<CPF>${doc}</CPF>` : `<CNPJ>${doc}</CNPJ>`}${el("xNome", text(t.name ?? "", 300))}${end}${el("email", t.email ? text(t.email, 80) : null)}</toma>`;
  }

  // Serviço
  const infoCompl =
    d.texts.orderNumber || d.texts.notes
      ? `<infoCompl>${el("xPed", d.texts.orderNumber ? text(d.texts.orderNumber, 60) : null)}${el("xInfComp", d.texts.notes ? text(d.texts.notes, 2000) : null)}</infoCompl>`
      : "";
  const serv =
    `<serv><locPrest><cLocPrestacao>${d.placeIbge}</cLocPrestacao></locPrest>` +
    `<cServ><cTribNac>${s.tribNac}</cTribNac>${el("xDescServ", text(d.texts.description, 1000))}${el("cNBS", s.nbs)}</cServ>${infoCompl}</serv>`;

  // Valores e tributos
  const totTrib = issuer.simples === 3 ? `<pTotTribSN>${pct(issuer.simples_rate!)}</pTotTribSN>` : `<indTotTrib>0</indTotTrib>`;
  const valores =
    `<valores><vServPrest><vServ>${money(total)}</vServ></vServPrest>` +
    `<trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${d.issRetention}</tpRetISSQN>${issuer.iss_rate != null ? `<pAliq>${pct(issuer.iss_rate)}</pAliq>` : ""}</tribMun>` +
    `<totTrib>${totTrib}</totTrib></trib></valores>`;

  const [y, m, dd] = d.competence.split("-");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="${DPS_NAMESPACE}" versao="${DPS_VERSION}"><infDPS Id="${id}">` +
    `<tpAmb>${o.environment === "producao" ? 1 : 2}</tpAmb>` +
    `<dhEmi>${brasiliaDateTime(o.issuedAt)}</dhEmi>` +
    `<verAplic>${esc(o.appVersion.slice(0, 20))}</verAplic>` +
    `<serie>${o.series.replace(/^0+(?=\d)/, "")}</serie>` +
    `<nDPS>${o.number}</nDPS>` +
    `<dCompet>${y}-${m}-${dd}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    `<cLocEmi>${issuer.city_ibge}</cLocEmi>` +
    prest +
    toma +
    serv +
    valores +
    `</infDPS></DPS>`
  );
}
