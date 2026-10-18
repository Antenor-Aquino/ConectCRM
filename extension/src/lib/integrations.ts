// Configurações → Integrações (spec 09). Os parâmetros ficam só neste
// computador (chrome.storage.local), como as chaves de IA: não vão para o
// backup. Por enquanto só o Pipedrive.
import { PIPEDRIVE_ORIGIN } from "./pipedrive/api";

const KEY = "conectcrm-integrations";
const MAPPING_KEY = "conectcrm-pipedrive-mappings";

export interface PipedriveSettings {
  token: string;
  /** Subdomínio da conta ("suaempresa" em suaempresa.pipedrive.com), para abrir o original. */
  domain: string;
  active: boolean;
  /** Preenchido por "Testar conexão". */
  account?: { user: string; email: string; company: string; checkedAt: string };
}

export interface IntegrationsSettings {
  pipedrive: PipedriveSettings;
}

const EMPTY: IntegrationsSettings = { pipedrive: { token: "", domain: "", active: false } };

export async function loadIntegrations(): Promise<IntegrationsSettings> {
  const saved = (await chrome.storage.local.get(KEY))[KEY] as Partial<IntegrationsSettings> | undefined;
  return { pipedrive: { ...EMPTY.pipedrive, ...saved?.pipedrive } };
}

export async function saveIntegrations(s: IntegrationsSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

/** "https://suaempresa.pipedrive.com" a partir do que foi digitado (domínio, URL ou subdomínio). */
export function pipedriveBaseUrl(domain: string): string | null {
  const d = domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.pipedrive\.com$/i, "");
  return d ? `https://${d}.pipedrive.com` : null;
}

/** Link do registro no Pipedrive. */
export function pipedriveRecordUrl(domain: string, entity: "person" | "organization" | "deal", id: string): string | null {
  const base = pipedriveBaseUrl(domain);
  if (!base) return null;
  return entity === "deal" ? `${base}/leads/inbox/${id}` : `${base}/${entity}/${id}`;
}

/** Permissão de acesso à API (pedida ao conectar; fica fora do pacote para não desativar a extensão na atualização). */
export async function requestPipedrivePermission(): Promise<boolean> {
  return chrome.permissions?.request ? chrome.permissions.request({ origins: [PIPEDRIVE_ORIGIN] }) : true;
}

/** De-para salvo por tipo (vem preenchido na próxima importação). */
export async function loadPipedriveMappings<T>(): Promise<Partial<Record<string, T>>> {
  return ((await chrome.storage.local.get(MAPPING_KEY))[MAPPING_KEY] as Partial<Record<string, T>> | undefined) ?? {};
}

export async function savePipedriveMapping<T>(entity: string, mapping: T): Promise<void> {
  const all = await loadPipedriveMappings<T>();
  await chrome.storage.local.set({ [MAPPING_KEY]: { ...all, [entity]: mapping } });
}
