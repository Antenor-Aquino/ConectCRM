// Configurações que ficam fora do banco (chrome.storage) vão junto no backup
// e na mudança de instalação, num "configuracoes.json". Senhas e chaves
// (IA, Z-API, Pipedrive, CallMeBot, licença) só vão quando o usuário pede —
// o arquivo fica em texto puro. Ao importar sem elas, as que já existem
// nesta instalação são mantidas.

export const SETTINGS_FILE = "configuracoes.json";
export const SETTINGS_BACKUP_FILE = "conectcrm-configuracoes.json";
const FORMAT = "conectcrm-configuracoes";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

interface Spec {
  key: string;
  label: string;
  /** Tira as senhas/chaves (exportação sem credenciais). */
  strip?: (v: unknown) => unknown;
  /** Devolve ao valor importado (sem credenciais) as que esta instalação já tem. */
  keep?: (imported: unknown, current: unknown) => unknown;
  /** Só vai quando as credenciais vão (ex.: licença). */
  secretOnly?: boolean;
}

/** Aplica `fn` em cada usuário (configurações guardadas por usuário). */
const perUser = (v: unknown, fn: (u: Obj, cur?: Obj) => Obj, cur?: unknown): unknown =>
  isObj(v) ? Object.fromEntries(Object.entries(v).map(([id, u]) => [id, isObj(u) ? fn(u, isObj(cur) && isObj(cur[id]) ? (cur[id] as Obj) : undefined) : u])) : v;

const SPECS: Spec[] = [
  {
    key: "conectcrm-notify-settings",
    label: "Notificações e lembretes",
    strip: (v) => perUser(v, (u) => (isObj(u.whatsapp) ? { ...u, whatsapp: { ...u.whatsapp, apikey: "" } } : u)),
    keep: (v, cur) =>
      perUser(v, (u, c) => (isObj(u.whatsapp) && isObj(c?.whatsapp) && !u.whatsapp.apikey ? { ...u, whatsapp: { ...u.whatsapp, apikey: c.whatsapp.apikey } } : u), cur),
  },
  { key: "conectcrm-sound", label: "Som e janela de aviso" },
  { key: "conectcrm-mail-sender", label: "Conta que envia os e-mails" },
  {
    key: "conectcrm-whatsapp-senders",
    label: "Números de WhatsApp",
    strip: (v) => perUser(v, (u) => (Array.isArray(u.senders) ? { ...u, senders: u.senders.map((s: Obj) => ({ ...s, zapi: undefined })) } : u)),
    keep: (v, cur) =>
      perUser(
        v,
        (u, c) => {
          if (!Array.isArray(u.senders) || !Array.isArray(c?.senders)) return u;
          const old = new Map((c.senders as Obj[]).map((s) => [s.id, s.zapi]));
          return { ...u, senders: (u.senders as Obj[]).map((s) => (s.zapi ? s : { ...s, zapi: old.get(s.id) })) };
        },
        cur,
      ),
  },
  {
    key: "conectcrm-ai",
    label: "Inteligência artificial",
    strip: (v) => (isObj(v) ? { ...v, keys: {} } : v),
    keep: (v, cur) => (isObj(v) && isObj(cur) && isObj(cur.keys) ? { ...v, keys: { ...cur.keys, ...(isObj(v.keys) ? v.keys : {}) } } : v),
  },
  {
    key: "conectcrm-integrations",
    label: "Integrações (Pipedrive)",
    strip: (v) => (isObj(v) && isObj(v.pipedrive) ? { ...v, pipedrive: { ...v.pipedrive, token: "" } } : v),
    keep: (v, cur) =>
      isObj(v) && isObj(v.pipedrive) && !v.pipedrive.token && isObj(cur) && isObj(cur.pipedrive) ? { ...v, pipedrive: { ...v.pipedrive, token: cur.pipedrive.token } } : v,
  },
  { key: "conectcrm-pipedrive-mappings", label: "De-para do Pipedrive" },
  { key: "conectcrm-auto-backup", label: "Backup do banco (frequência e retenção)" },
  { key: "conectcrm-doc-backup", label: "Backup dos documentos" },
  { key: "conectcrm-license", label: "Licença", secretOnly: true },
  { key: "conectcrm-agreed-terms", label: "Aceite dos termos" },
];

export interface SettingsFile {
  format: typeof FORMAT;
  version: 1;
  exportedAt: string;
  /** Instalação de origem (ID da extensão) e versão. */
  extensionId: string;
  appVersion: string;
  withSecrets: boolean;
  items: Record<string, unknown>;
}

/** Monta o arquivo a partir do que está guardado (puro, para testes). */
export function buildSettingsFile(stored: Record<string, unknown>, opts: { withSecrets: boolean; extensionId: string; appVersion: string; now?: Date }): SettingsFile {
  const items: Record<string, unknown> = {};
  for (const s of SPECS) {
    const v = stored[s.key];
    if (v === undefined || (s.secretOnly && !opts.withSecrets)) continue;
    items[s.key] = opts.withSecrets || !s.strip ? v : s.strip(v);
  }
  return { format: FORMAT, version: 1, exportedAt: (opts.now ?? new Date()).toISOString(), extensionId: opts.extensionId, appVersion: opts.appVersion, withSecrets: opts.withSecrets, items };
}

export function parseSettingsFile(text: string): SettingsFile {
  let f: unknown;
  try {
    f = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("Arquivo de configurações inválido.");
  }
  if (!isObj(f) || f.format !== FORMAT || !isObj(f.items)) throw new Error("Este arquivo não é de configurações do ConectCRM.");
  return f as unknown as SettingsFile;
}

/** O que gravar ao importar (puro): só chaves conhecidas, mantendo as credenciais atuais quando o arquivo não as traz. */
export function settingsToApply(file: SettingsFile, current: Record<string, unknown>, extensionId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of SPECS) {
    if (!(s.key in file.items)) continue;
    const v = file.items[s.key];
    out[s.key] = !file.withSecrets && s.keep && current[s.key] !== undefined ? s.keep(v, current[s.key]) : v;
  }
  // As pastas não passam de uma instalação para outra: precisam ser escolhidas de novo.
  if (file.extensionId !== extensionId) {
    for (const k of ["conectcrm-auto-backup", "conectcrm-doc-backup"]) if (isObj(out[k])) out[k] = { ...out[k], folderName: isObj(current[k]) ? (current[k].folderName ?? null) : null };
  }
  return out;
}

/** Nomes das configurações presentes no arquivo (para a confirmação). */
export const settingsLabels = (file: SettingsFile) => SPECS.filter((s) => s.key in file.items).map((s) => s.label);

// ---------- chrome.storage ----------

export async function exportSettings(withSecrets: boolean): Promise<SettingsFile> {
  const stored = await chrome.storage.local.get(SPECS.map((s) => s.key));
  return buildSettingsFile(stored, { withSecrets, extensionId: chrome.runtime.id, appVersion: chrome.runtime.getManifest().version });
}

export const settingsJson = (f: SettingsFile) => JSON.stringify(f, null, 2);

export async function importSettings(file: SettingsFile): Promise<string[]> {
  const current = await chrome.storage.local.get(SPECS.map((s) => s.key));
  await chrome.storage.local.set(settingsToApply(file, current, chrome.runtime.id));
  return settingsLabels(file);
}
