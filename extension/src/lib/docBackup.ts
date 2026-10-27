// Backup dos documentos (GED), separado do backup do banco e com parâmetros
// próprios. Grava um ESPELHO legível em "<pasta>/ConectCRM - Documentos/":
// as mesmas pastas do GED, o nome do documento com o código do conteúdo
// "(fe2d460b)" e um indice.csv (abre no Excel) — os arquivos servem mesmo sem
// o CRM, e "Localizar documentos" reconhece cada um pelo código. É
// incremental: só copia o que mudou; documento renomeado ou movido no GED é
// movido no espelho; o que sai do GED vai para "_removidos/AAAA-MM-DD/" e é
// apagado depois de N dias. Roda quando o CRM abre (a File System Access API
// precisa de uma página), na frequência escolhida.
import type { BackupEntry } from "../db/documentBackup";
import { call } from "../rpc/client";
import { isBackupDue, loadAutoBackupSettings, type BackupFrequency } from "./autoBackup";
import { loadBackupFolderHandle, type PermissionedDirectoryHandle } from "./backupFolder";
import { currentEnv } from "./documentFiles";
import { errorText } from "./errors";
import { dirFor, readContent, sha256Hex, writeToFolder } from "./fileStore";
import { addNotification } from "./notifications";

export type DocBackupFrequency = "open" | BackupFrequency | "manual";

export interface DocBackupResult {
  at: string;
  total: number;
  bytes: number;
  copied: number;
  moved: number;
  removed: number;
  failed: number;
  /** Conferidos pelo conteúdo (conferência completa ou arquivo sem registro). */
  verified: number;
  full: boolean;
  errors: string[];
}

export interface DocBackupSettings {
  enabled: boolean;
  frequency: DocBackupFrequency;
  /** false = na mesma pasta do backup do banco. */
  ownFolder: boolean;
  folderName: string | null;
  includeOldVersions: boolean;
  /** Dias que os arquivos removidos do GED ficam em "_removidos". */
  keepRemovedDays: number;
  /** Uma vez por semana, confere o conteúdo de todos os arquivos (lê tudo). */
  fullVerifyWeekly: boolean;
  /** Avisa no sino se ficar este número de dias sem backup. */
  alertDays: number;
  lastRunAt: string | null;
  lastFullVerifyAt: string | null;
  last: DocBackupResult | null;
}

const KEY = "conectcrm-doc-backup";
export const MIRROR_DIR = "ConectCRM - Documentos";
const STATE_FILE = ".conectcrm-espelho.json";
const REMOVED_DIR = "_removidos";
const INDEX_FILE = "indice.csv";

const DEFAULTS: DocBackupSettings = {
  enabled: false,
  frequency: "daily",
  ownFolder: false,
  folderName: null,
  includeOldVersions: true,
  keepRemovedDays: 30,
  fullVerifyWeekly: false,
  alertDays: 7,
  lastRunAt: null,
  lastFullVerifyAt: null,
  last: null,
};

/** Na primeira vez, herda do backup do banco (que até a 0.2.72 copiava os documentos junto). */
export async function loadDocBackupSettings(): Promise<DocBackupSettings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as Partial<DocBackupSettings> | undefined;
  if (stored) return { ...DEFAULTS, ...stored };
  const db = await loadAutoBackupSettings();
  return { ...DEFAULTS, enabled: db.enabled, frequency: db.frequency };
}

export async function saveDocBackupSettings(s: DocBackupSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

/** A pasta onde fica o espelho: a própria ou a do backup do banco. */
export function docBackupFolder(s: Pick<DocBackupSettings, "ownFolder">): Promise<PermissionedDirectoryHandle | null> {
  return loadBackupFolderHandle(s.ownFolder ? "docs" : "dir").catch(() => null);
}

const HOUR = 3600_000;
export function isDocBackupDue(s: Pick<DocBackupSettings, "frequency" | "lastRunAt">, now = new Date()): boolean {
  if (s.frequency === "manual") return false;
  if (s.frequency === "open") return !s.lastRunAt || now.getTime() - new Date(s.lastRunAt).getTime() >= HOUR;
  return isBackupDue(s.frequency, s.lastRunAt, now);
}

export const isFullVerifyDue = (s: Pick<DocBackupSettings, "fullVerifyWeekly" | "lastFullVerifyAt">, now = new Date()) =>
  s.fullVerifyWeekly && (!s.lastFullVerifyAt || now.getTime() - new Date(s.lastFullVerifyAt).getTime() >= 7 * 24 * HOUR);

// ---------- Espelho ----------

interface MirrorState {
  version: 1;
  files: Record<string, { sha256: string; size: number }>;
}

async function fileAt(root: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  try {
    const { dir, file } = await dirFor(root, path, false);
    return await (await dir.getFileHandle(file)).getFile();
  } catch {
    return null;
  }
}

async function readState(root: FileSystemDirectoryHandle): Promise<MirrorState> {
  try {
    const s = JSON.parse(await (await (await root.getFileHandle(STATE_FILE)).getFile()).text()) as MirrorState;
    if (s?.version === 1 && s.files) return s;
  } catch {
    // Primeiro backup (ou registro perdido): os arquivos que já estão lá são conferidos pelo conteúdo.
  }
  return { version: 1, files: {} };
}

async function writeText(root: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  await writeToFolder(root, name, new Blob([text], { type: "text/plain" }));
}

/** Apaga o arquivo e as pastas que ficarem vazias. */
async function removeFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split("/");
  const name = parts.pop()!;
  const chain: FileSystemDirectoryHandle[] = [root];
  try {
    for (const p of parts) chain.push(await chain[chain.length - 1]!.getDirectoryHandle(p));
    await chain[chain.length - 1]!.removeEntry(name);
    for (let i = parts.length - 1; i >= 0; i--) {
      const dir = chain[i + 1]!;
      const it = (dir as unknown as { keys(): AsyncIterator<string> }).keys();
      if (!(await it.next()).done) break;
      await chain[i]!.removeEntry(parts[i]!);
    }
  } catch {
    // Já não existe.
  }
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function purgeRemoved(root: FileSystemDirectoryHandle, keepDays: number, now: Date): Promise<void> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await root.getDirectoryHandle(REMOVED_DIR);
  } catch {
    return;
  }
  const limit = localDay(new Date(now.getTime() - keepDays * 24 * HOUR));
  const old: string[] = [];
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < limit) old.push(name);
  for (const name of old) await dir.removeEntry(name, { recursive: true }).catch(() => {});
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const brDate = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

export function indexCsv(list: BackupEntry[]): string {
  const head = [
    "Arquivo no backup",
    "Documento",
    "Classificação",
    "Pasta no GED",
    "Versão",
    "Versão atual",
    "Arquivo original",
    "Data do documento",
    "Validade",
    "Vínculos",
    "Enviado por",
    "Enviado em",
    "Tamanho (bytes)",
    "SHA-256",
  ];
  const rows = list.map((e) => [
    e.target,
    e.name,
    e.typeName,
    e.folder || "(sem pasta)",
    e.version,
    e.current ? "sim" : "não",
    e.filename,
    brDate(e.docDate),
    brDate(e.validUntil),
    e.links,
    e.createdBy,
    brDate(e.createdAt),
    e.size,
    e.sha256,
  ]);
  return `﻿${[head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

const README = `Backup dos documentos do ConectCRM (GED)

- As pastas são as mesmas do GED; o nome é o do documento seguido do código do
  conteúdo, ex.: "Contrato Perseus (fe2d460b).pdf".
- "${INDEX_FILE}" (abre no Excel) lista cada arquivo com classificação, pasta,
  vínculos, validade e quem enviou.
- "_versões anteriores": versões antigas dos documentos.
- "_removidos/AAAA-MM-DD": arquivos que saíram do GED nesse dia; são apagados
  depois do prazo definido em Configurações → Backup.
- Para recuperar no CRM: Configurações → Documentos → Localizar documentos, e
  escolha esta pasta.
- Não altere "${STATE_FILE}": é o controle do backup incremental.
`;

export interface DocBackupProgress {
  done: number;
  total: number;
}

/** Faz o backup dos documentos na pasta (espelho incremental). */
export async function runDocBackup(
  handle: PermissionedDirectoryHandle,
  settings: DocBackupSettings,
  opts: { full?: boolean; onProgress?: (p: DocBackupProgress) => void; now?: Date } = {},
): Promise<DocBackupResult> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return doRun(handle, settings, opts);
  return locks.request("conectcrm-doc-backup", { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Já há um backup dos documentos em andamento (em outra aba do CRM).");
    return doRun(handle, settings, opts);
  });
}

async function doRun(
  handle: PermissionedDirectoryHandle,
  settings: DocBackupSettings,
  opts: { full?: boolean; onProgress?: (p: DocBackupProgress) => void; now?: Date },
): Promise<DocBackupResult> {
  const now = opts.now ?? new Date();
  const env = await currentEnv();
  const root = await handle.getDirectoryHandle(MIRROR_DIR, { create: true });
  const state = await readState(root);
  const list = await call("files.backupList", { includeOldVersions: settings.includeOldVersions });
  const r: DocBackupResult = {
    at: now.toISOString(),
    total: list.length,
    bytes: list.reduce((n, e) => n + e.size, 0),
    copied: 0,
    moved: 0,
    removed: 0,
    failed: 0,
    verified: 0,
    full: !!opts.full,
    errors: [],
  };
  const expected = new Set(list.map((e) => e.target));
  const shaPaths = new Map<string, string[]>();
  for (const [p, f] of Object.entries(state.files)) shaPaths.set(f.sha256, [...(shaPaths.get(f.sha256) ?? []), p]);
  const saveState = () => writeText(root, STATE_FILE, JSON.stringify(state));

  let n = 0;
  for (const e of list) {
    opts.onProgress?.({ done: n++, total: list.length });
    try {
      const known = state.files[e.target];
      const existing = await fileAt(root, e.target);
      if (existing && existing.size === e.size) {
        if (known?.sha256 === e.sha256 && !opts.full) continue;
        if ((await sha256Hex(existing)) === e.sha256) {
          state.files[e.target] = { sha256: e.sha256, size: e.size };
          r.verified++;
          continue;
        }
      }
      // Renomeado ou movido no GED: o arquivo já está no espelho com outro nome.
      let blob: Blob | null = null;
      for (const p of shaPaths.get(e.sha256) ?? []) {
        if (p === e.target) continue;
        const f = await fileAt(root, p);
        if (f && f.size === e.size) {
          blob = f;
          break;
        }
      }
      const fromMirror = !!blob;
      blob ??= await readContent(env, { sha256: e.sha256, location: e.location, path: e.path, mime: e.mime });
      await writeToFolder(root, e.target, blob);
      state.files[e.target] = { sha256: e.sha256, size: e.size };
      if (fromMirror) r.moved++;
      else r.copied++;
    } catch (err) {
      r.failed++;
      if (r.errors.length < 20) r.errors.push(`${e.name}: ${errorText(err)}`);
    }
    if (n % 50 === 0) await saveState();
  }

  // O que saiu do GED (ou mudou de nome/pasta): vai para _removidos ou some (se o conteúdo continua em outro lugar).
  const keptShas = new Set(list.map((e) => e.sha256));
  const day = localDay(now);
  for (const [p, f] of Object.entries(state.files)) {
    if (expected.has(p)) continue;
    const file = await fileAt(root, p);
    if (file && !keptShas.has(f.sha256)) {
      await writeToFolder(root, `${REMOVED_DIR}/${day}/${p}`, file).catch(() => {});
      r.removed++;
    }
    if (file) await removeFile(root, p);
    delete state.files[p];
  }
  await purgeRemoved(root, settings.keepRemovedDays, now);
  await writeText(root, INDEX_FILE, indexCsv(list));
  await writeText(root, "LEIA-ME.txt", README);
  await saveState();
  opts.onProgress?.({ done: list.length, total: list.length });
  return r;
}

/** Resumo para o aviso e a tela. */
export function docBackupSummary(r: DocBackupResult): string {
  const parts = [`${r.total} arquivo(s) no backup`];
  if (r.copied) parts.push(`${r.copied} copiado(s)`);
  if (r.moved) parts.push(`${r.moved} renomeado(s)/movido(s)`);
  if (r.removed) parts.push(`${r.removed} para "_removidos"`);
  if (r.full) parts.push(`conferência completa (${r.verified} conferido(s) pelo conteúdo)`);
  if (r.failed) parts.push(`${r.failed} com erro`);
  return `${parts.join(", ")}.`;
}

/** Roda, grava o resultado e avisa no sino (só quando algo mudou ou deu erro). */
export async function runAndRecordDocBackup(
  handle: PermissionedDirectoryHandle,
  settings: DocBackupSettings,
  opts: { full?: boolean; onProgress?: (p: DocBackupProgress) => void; quiet?: boolean } = {},
): Promise<DocBackupResult> {
  const full = opts.full ?? isFullVerifyDue(settings);
  const r = await runDocBackup(handle, settings, { ...opts, full });
  const fresh = await loadDocBackupSettings();
  await saveDocBackupSettings({
    ...fresh,
    lastRunAt: r.at,
    last: r,
    folderName: fresh.ownFolder ? handle.name : fresh.folderName,
    lastFullVerifyAt: full ? r.at : fresh.lastFullVerifyAt,
  });
  if (r.failed) {
    await addNotification({ kind: "error", title: "Backup dos documentos com erros", message: `${docBackupSummary(r)} ${r.errors.slice(0, 3).join(" · ")}` });
  } else if (!opts.quiet || r.copied || r.moved || r.removed) {
    await addNotification({ kind: "success", title: "Backup dos documentos concluído", message: `Em "${handle.name}/${MIRROR_DIR}": ${docBackupSummary(r)}` });
  }
  return r;
}

export type DocBackupCheck =
  | { status: "skipped" }
  | { status: "done"; result: DocBackupResult }
  | { status: "needs-permission"; handle: PermissionedDirectoryHandle; settings: DocBackupSettings }
  | { status: "error"; message: string };

/** Chamada ao abrir o CRM (só Produção). */
export async function checkDocBackup(): Promise<DocBackupCheck> {
  if ((await currentEnv()) !== "production") return { status: "skipped" };
  const s = await loadDocBackupSettings();
  await warnIfOverdue(s);
  if (!s.enabled || !isDocBackupDue(s)) return { status: "skipped" };
  const handle = await docBackupFolder(s);
  if (!handle) return { status: "skipped" };
  if ((await handle.queryPermission({ mode: "readwrite" }).catch(() => "denied")) !== "granted") return { status: "needs-permission", handle, settings: s };
  try {
    return { status: "done", result: await runAndRecordDocBackup(handle, s, { quiet: true }) };
  } catch (err) {
    const message = errorText(err);
    await addNotification({ kind: "error", title: "Backup dos documentos falhou", message });
    return { status: "error", message };
  }
}

/** Avisa (uma vez por dia) se o backup dos documentos está atrasado. */
async function warnIfOverdue(s: DocBackupSettings, now = new Date()): Promise<void> {
  if (!s.enabled || s.frequency === "manual" || !s.lastRunAt || !s.alertDays) return;
  const days = Math.floor((now.getTime() - new Date(s.lastRunAt).getTime()) / (24 * HOUR));
  if (days < s.alertDays) return;
  const key = "conectcrm-doc-backup-alerta";
  try {
    if (localStorage.getItem(key) === localDay(now)) return;
    localStorage.setItem(key, localDay(now));
  } catch {
    // Sem armazenamento local: avisa mesmo assim.
  }
  await addNotification({
    kind: "error",
    title: "Backup dos documentos atrasado",
    message: `O último backup dos documentos foi há ${days} dias. Veja em Configurações → Backup e ambiente.`,
  });
}
