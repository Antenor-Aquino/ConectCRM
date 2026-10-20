// Ponte com a extensão Gestão Financeira (spec 13): encontrar, parear e
// conversar. Sem ID fixo: o ConectCRM acha a Gestão Financeira instalada
// neste Chrome (chrome.management) e pede para se conectar; o usuário permite
// lá. Assim nenhuma das duas troca de ID (os dados de cada uma ficam presos
// ao ID) e reinstalar de outra pasta só pede um novo pareamento.
import { PROTOCOL, type IntegrationRequest, type IntegrationResponse, type GfEnv } from "./protocol";

const KEY = "conectcrm-gestao-financeira";

export interface GfSettings {
  /** ID da Gestão Financeira pareada (ou digitado manualmente). */
  gfId: string | null;
  pairedAt: string | null;
  /** Formas de integração: direta (mesmo Chrome) e/ou pacote de arquivo. */
  direct: boolean;
  package: boolean;
}

export const DEFAULT_GF_SETTINGS: GfSettings = { gfId: null, pairedAt: null, direct: true, package: false };

export async function loadGfSettings(): Promise<GfSettings> {
  return { ...DEFAULT_GF_SETTINGS, ...((await chrome.storage.local.get(KEY))[KEY] as Partial<GfSettings> | undefined) };
}

export async function saveGfSettings(s: GfSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export interface GfInstall {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

const GF_NAME = /gest[aã]o\s+financeira/i;

/** Gestões Financeiras instaladas neste Chrome (normalmente uma). */
export async function findGfInstalls(): Promise<GfInstall[]> {
  if (!chrome.management?.getAll) return [];
  const all = await chrome.management.getAll();
  return all
    .filter((e) => e.type === "extension" && GF_NAME.test(e.name) && e.id !== chrome.runtime.id)
    .map((e) => ({ id: e.id, name: e.name, version: e.version, enabled: e.enabled }));
}

export class GfError extends Error {}

/** Envia uma mensagem para a Gestão Financeira (com tempo limite). */
export async function sendToGf(gfId: string, msg: IntegrationRequest, timeoutMs = 8000): Promise<IntegrationResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      chrome.runtime.sendMessage(gfId, msg) as Promise<IntegrationResponse | undefined>,
      new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new GfError("A Gestão Financeira não respondeu.")), timeoutMs))),
    ]).then((r) => {
      if (!r) throw new GfError("A Gestão Financeira não respondeu (versão antiga, sem a integração? Atualize-a).");
      return r;
    });
  } catch (e) {
    if (e instanceof GfError) throw e;
    const m = e instanceof Error ? e.message : String(e);
    if (/Could not establish connection|Receiving end does not exist/i.test(m))
      throw new GfError("A Gestão Financeira não está instalada, está desativada ou é de uma versão sem a integração.");
    throw new GfError(m);
  } finally {
    clearTimeout(timer);
  }
}

export function hello(gfId: string): Promise<IntegrationResponse> {
  return sendToGf(gfId, { type: "hello", app: "conectcrm", appName: "ConectCRM", appVersion: chrome.runtime.getManifest().version, protocol: PROTOCOL });
}

export function ping(gfId: string): Promise<IntegrationResponse> {
  return sendToGf(gfId, { type: "ping", protocol: PROTOCOL });
}

export const GF_ENV_LABEL: Record<GfEnv, string> = { production: "Produção", demo: "Teste (dados de exemplo)" };

/** Texto para o usuário de uma resposta que não é "conectado". */
export function responseText(r: IntegrationResponse): string {
  if (r.ok && r.status === "pending") return "Pedido enviado. Abra a Gestão Financeira e clique em Permitir.";
  if (r.ok && r.status === "refused")
    return "A Gestão Financeira recusou a conexão. Lá, em Configurações → Integrações, clique em \"Permitir pedir de novo\" e conecte de novo.";
  if (!r.ok && r.error === "not-paired") return "A Gestão Financeira não reconhece este ConectCRM (foi desconectado lá?). Conecte de novo.";
  if (!r.ok) return r.message ?? "A Gestão Financeira recusou a mensagem.";
  return "";
}
