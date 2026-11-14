// ConectCRM Fiscal (spec 20): programa auxiliar no Windows que assina e envia a
// NFS-e à API Sefin Nacional. A extensão fala com ele pelo Native Messaging.
import type { NfseEnvironment } from "../../db/nfse";

export const FISCAL_HOST = "com.conectcrm.fiscal";

export interface FiscalCert {
  thumbprint: string;
  subject: string;
  issuer: string;
  cnpj: string;
  cpf: string;
  notBefore: string;
  notAfter: string;
}

export interface SefinResult {
  httpStatus: number;
  body?: unknown;
  text?: string;
  accessKey?: string;
  nfseXml?: string;
  eventXml?: string;
}

interface FiscalResponse {
  id: string;
  ok: boolean;
  error?: string;
  version?: string;
  certs?: FiscalCert[];
  signed?: string;
  result?: SefinResult;
}

export class FiscalNotInstalled extends Error {}
/** O programa abriu, mas fechou sozinho (travou) antes de responder. */
export class FiscalCrashed extends Error {}

/** Mensagens do Chrome quando o programa não está instalado/registrado. */
function friendly(message: string): Error {
  if (/not found|forbidden/i.test(message))
    return new FiscalNotInstalled("O ConectCRM Fiscal não está instalado neste computador (ou foi removido). Instale o ConectCRMFiscal.exe e reabra o Chrome.");
  if (/has exited|Error when communicating/i.test(message))
    return new FiscalCrashed(
      "O ConectCRM Fiscal fechou sozinho no meio da operação (em geral, o programa do certificado ou do token travou). Tente de novo; se repetir, envie o arquivo fiscal.log da pasta %LOCALAPPDATA%\\ConectCRM\\Fiscal.",
    );
  return new Error(`ConectCRM Fiscal: ${message}`);
}

let seq = 0;
export function fiscalCall(msg: Record<string, unknown>): Promise<FiscalResponse> {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.sendNativeMessage) return reject(new FiscalNotInstalled("Este navegador não permite usar o ConectCRM Fiscal."));
    chrome.runtime.sendNativeMessage(FISCAL_HOST, { id: String(++seq), ...msg }, (res: FiscalResponse | undefined) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(friendly(err.message ?? "sem resposta"));
      if (!res) return reject(new Error("ConectCRM Fiscal não respondeu."));
      if (!res.ok) return reject(new Error(res.error ?? "Erro no ConectCRM Fiscal."));
      resolve(res);
    });
  });
}

/** Programa instalado? (versão ou null) */
export async function fiscalVersion(): Promise<string | null> {
  try {
    return (await fiscalCall({ cmd: "ping" })).version ?? "?";
  } catch {
    return null;
  }
}

export async function listFiscalCerts(): Promise<FiscalCert[]> {
  return (await fiscalCall({ cmd: "listCerts" })).certs ?? [];
}

export async function emitViaFiscal(env: NfseEnvironment, thumbprint: string, dpsXml: string): Promise<SefinResult> {
  const r = await fiscalCall({ cmd: "emit", env, thumbprint, xml: dpsXml });
  if (!r.result) throw new Error("ConectCRM Fiscal não devolveu a resposta da Receita.");
  return r.result;
}

/** Pedido de evento (cancelamento) assinado e enviado pelo ConectCRM Fiscal. */
export async function eventViaFiscal(env: NfseEnvironment, thumbprint: string, accessKey: string, eventXml: string): Promise<{ result: SefinResult; signed: string }> {
  const r = await fiscalCall({ cmd: "event", env, thumbprint, accessKey, xml: eventXml });
  if (!r.result) throw new Error("ConectCRM Fiscal não devolveu a resposta da Receita.");
  return { result: r.result, signed: r.signed ?? eventXml };
}

/**
 * Chave de uma nota que não existe (número 0) da própria empresa, para testar a
 * conexão: cMun(7) + ambiente gerador(1) + tipo de inscrição(1) + CNPJ(14) +
 * nNFSe(13) + AAMM(4) + código(9) + DV(1).
 */
export function probeAccessKey(cityIbge: string, cnpj: string, now = new Date()): string {
  const aamm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `${cityIbge.padStart(7, "0")}22${cnpj.replace(/\D/g, "").padStart(14, "0")}${"0".repeat(13)}${aamm}${"0".repeat(10)}`;
}

export interface ConnectionTest {
  ok: boolean;
  /** Texto para a tela. */
  message: string;
  detail?: string;
}

/** Interpreta a resposta da consulta de teste: chegar na Receita com o certificado aceito é o que importa. */
export function classifyProbe(r: SefinResult): ConnectionTest {
  const detail = sefinErrors(r).join(" | ");
  if (r.httpStatus === 401 || r.httpStatus === 495 || r.httpStatus === 496)
    return { ok: false, message: "A Receita recusou o certificado desta conexão. Confira se é o certificado da empresa (e-CNPJ ICP-Brasil) e se não está vencido.", detail };
  if (r.httpStatus >= 500) return { ok: false, message: `A Receita está com problema agora (HTTP ${r.httpStatus}). Tente de novo mais tarde.`, detail };
  return { ok: true, message: "Conexão com a Receita funcionando: o certificado foi aceito. Nenhuma nota foi emitida no teste." };
}

/** Testa certificado + PIN + conexão com a Sefin, sem emitir nada (consulta uma nota inexistente). */
export async function testSefinConnection(env: NfseEnvironment, thumbprint: string, cityIbge: string, cnpj: string): Promise<ConnectionTest> {
  try {
    const r = await fiscalCall({ cmd: "query", env, thumbprint, accessKey: probeAccessKey(cityIbge, cnpj) });
    if (!r.result) return { ok: false, message: "ConectCRM Fiscal não devolveu a resposta da Receita." };
    return classifyProbe(r.result);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (e instanceof FiscalNotInstalled) return { ok: false, message: m };
    if (/PIN|cancel|canceled|cancelad/i.test(m)) return { ok: false, message: "O PIN do token não foi informado (ou foi cancelado).", detail: m };
    if (/sem conexão|tls|handshake|certificate|x509|reset/i.test(m))
      return { ok: false, message: "Não foi possível conectar à Receita com este certificado (a conexão segura falhou). Confira o certificado, a internet e o antivírus/proxy.", detail: m };
    return { ok: false, message: m };
  }
}

/** Número da NFS-e no XML devolvido pela Sefin. */
export const nfseNumberFromXml = (xml: string | null | undefined) => xml?.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1] ?? null;

/**
 * Erros devolvidos pela Sefin Nacional, em texto. Aceita as formas que a API usa
 * ({erros:[{codigo,descricao,complemento}]}, {erro:{...}}, listas, mensagem simples).
 */
export function sefinErrors(r: SefinResult): string[] {
  const out: string[] = [];
  const pick = (o: Record<string, unknown>, ...keys: string[]) => {
    for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase())) return o[k];
    return undefined;
  };
  const visit = (v: unknown) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v === "string") return void out.push(v);
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const code = pick(o, "codigo", "code");
    const desc = pick(o, "descricao", "mensagem", "message", "detail", "title");
    const extra = pick(o, "complemento");
    if (code || desc) out.push([code, desc, extra].filter(Boolean).join(" — "));
    else for (const k of ["erros", "erro", "errors", "alertas"]) {
      const inner = pick(o, k);
      if (inner) visit(inner);
    }
  };
  visit(r.body);
  if (!out.length && r.text) out.push(r.text.slice(0, 500));
  if (!out.length) out.push(`A Receita respondeu HTTP ${r.httpStatus} sem detalhes.`);
  return out;
}
