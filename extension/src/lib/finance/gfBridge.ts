// Ponte com a extensão Gestão Financeira (spec 13): encontrar, parear e
// conversar. Sem ID fixo: o ConectCRM acha a Gestão Financeira instalada
// neste Chrome (chrome.management) e pede para se conectar; o usuário permite
// lá. Assim nenhuma das duas troca de ID (os dados de cada uma ficam presos
// ao ID) e reinstalar de outra pasta só pede um novo pareamento.
import { PROTOCOL, type ContactCard, type FinanceItem, type IntegrationRequest, type IntegrationResponse, type GfEnv, type LaunchRequest } from "./protocol";

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

/**
 * A integração com a Gestão Financeira está ativada pelo usuário: conectada
 * (modo direto) ou no modo pacote. Sem isso, nenhuma tela, aviso, alerta do
 * resumo diário ou ferramenta do Copiloto fala da Gestão Financeira.
 */
export const gfIntegrationActive = (s: GfSettings | null | undefined): boolean => !!s && ((!!s.gfId && s.direct) || s.package);

/** Mudanças na configuração (para as telas se ajustarem sozinhas). */
export function onGfSettingsChange(cb: (s: GfSettings) => void): () => void {
  const fn = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) void loadGfSettings().then(cb);
  };
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
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

/**
 * Envia fichas de contato/organização (paridade de cadastros). A Gestão
 * Financeira anterior à 0.0.8 não conhece a mensagem: avisa para atualizar.
 */
export async function upsertContacts(gfId: string, contacts: ContactCard[]): Promise<{ created: number; updated: number; failed: { crmRef: string; message: string }[] }> {
  const r = await sendToGf(gfId, { type: "upsertContacts", protocol: PROTOCOL, contacts }, 20000);
  if (r.ok && r.status === "contacts") return r;
  if (!r.ok && r.error === "invalid") throw new GfError("Atualize a Gestão Financeira (0.0.8 ou mais nova) para receber os cadastros completos.");
  throw new GfError(responseText(r) || "A Gestão Financeira não recebeu os cadastros.");
}

/** Envia as fichas pendentes (alteradas no CRM); `rpc` = acesso ao banco (tela ou service worker). */
export async function pushPendingContactsVia(
  gfId: string,
  rpc: { pending: () => Promise<ContactCard[]>; sent: (refs: string[]) => Promise<unknown> },
): Promise<{ sent: number; failed: { crmRef: string; message: string }[] }> {
  const cards = await rpc.pending();
  if (!cards.length) return { sent: 0, failed: [] };
  const r = await upsertContacts(gfId, cards);
  const failed = new Set(r.failed.map((f) => f.crmRef));
  const ok = cards.map((c) => c.crmRef).filter((ref) => !failed.has(ref));
  if (ok.length) await rpc.sent(ok);
  return { sent: ok.length, failed: r.failed };
}

/** Abre a janela de lançamento da Gestão Financeira; devolve o id da janela (para saber quando fechou). */
export async function openLaunch(gfId: string, launch: LaunchRequest): Promise<number | null> {
  const r = await sendToGf(gfId, { type: "openLaunch", protocol: PROTOCOL, launch });
  if (r.ok && r.status === "opened") return r.windowId;
  throw new GfError(responseText(r) || "A Gestão Financeira não abriu o lançamento.");
}

/** Lançamentos destes cartões, lidos agora da Gestão Financeira. */
export async function listByOrigin(gfId: string, refs: string[]): Promise<{ items: FinanceItem[]; env: GfEnv; at: string }> {
  const r = await sendToGf(gfId, { type: "listByOrigin", protocol: PROTOCOL, refs }, 15000);
  if (r.ok && r.status === "items") return { items: r.items, env: r.env, at: r.at };
  throw new GfError(responseText(r) || "A Gestão Financeira não devolveu os lançamentos.");
}

/**
 * Todos os lançamentos vindos do CRM. A Gestão Financeira 0.0.5 só aceita a
 * lista de cartões: nela, pede em lotes os cartões que `cardIds()` devolve.
 */
export async function listAllFromCrm(gfId: string, cardIds: () => Promise<string[]>): Promise<{ items: FinanceItem[]; env: GfEnv; at: string }> {
  const r = await sendToGf(gfId, { type: "listByOrigin", protocol: PROTOCOL }, 20000);
  if (r.ok && r.status === "items") return { items: r.items, env: r.env, at: r.at };
  if (r.ok || r.error !== "invalid") throw new GfError(responseText(r) || "A Gestão Financeira não devolveu os lançamentos.");
  const ids = await cardIds();
  const out: FinanceItem[] = [];
  let last = { env: "production" as GfEnv, at: new Date().toISOString() };
  for (let i = 0; i < ids.length; i += 500) {
    const part = await listByOrigin(gfId, ids.slice(i, i + 500));
    out.push(...part.items);
    last = part;
  }
  return { items: out, env: last.env, at: last.at };
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
