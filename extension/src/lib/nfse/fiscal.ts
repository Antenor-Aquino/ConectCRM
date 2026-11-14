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

/** Mensagens do Chrome quando o programa não está instalado/registrado. */
function friendly(message: string): Error {
  if (/not found|forbidden|has exited|Error when communicating/i.test(message))
    return new FiscalNotInstalled("O ConectCRM Fiscal não está instalado neste computador (ou foi removido). Instale o ConectCRMFiscal.exe e reabra o Chrome.");
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
