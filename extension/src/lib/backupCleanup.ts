// Limpeza semanal dos backups do banco: apaga da pasta de backup os arquivos
// com mais de 7 dias de gerados (automáticos diários/semanais e os de "Fazer
// backup agora"), sempre mantendo o mais recente. Roda ao abrir o CRM, no
// máximo uma vez por semana, com confirmação; também pode ser forçada em
// Configurações → Backup. Os documentos do GED e a cópia das configurações
// não entram (não são cópias datadas).
import { loadBackupFolderHandle, type PermissionedDirectoryHandle } from "./backupFolder";

export const BACKUP_MAX_AGE_DAYS = 7;
const DAY = 86_400_000;
const KEY = "conectcrm-backup-cleanup";

export interface BackupCleanupState {
  /** Última limpeza feita (ou conferida sem nada para apagar). */
  lastRunAt: string | null;
  /** Última vez que a pergunta apareceu na abertura (respondida com "Não"). */
  lastAskedAt: string | null;
}

export async function loadCleanupState(): Promise<BackupCleanupState> {
  return { lastRunAt: null, lastAskedAt: null, ...((await chrome.storage.local.get(KEY))[KEY] as Partial<BackupCleanupState> | undefined) };
}

export async function saveCleanupState(patch: Partial<BackupCleanupState>): Promise<BackupCleanupState> {
  const next = { ...(await loadCleanupState()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

/** Arquivo de backup do banco do ConectCRM (automático ou manual). */
export function isDbBackupFile(name: string): boolean {
  return /^(diario_|Semanal_)?conectcrm-backup-.+\.sqlite$/.test(name);
}

export interface BackupFileInfo {
  name: string;
  lastModified: number;
  size: number;
}

/** Os backups com mais de 7 dias, sem nunca incluir o mais recente da pasta. */
export function oldBackups(files: BackupFileInfo[], now = Date.now()): BackupFileInfo[] {
  const mine = files.filter((f) => isDbBackupFile(f.name)).sort((a, b) => b.lastModified - a.lastModified);
  return mine.slice(1).filter((f) => now - f.lastModified > BACKUP_MAX_AGE_DAYS * DAY);
}

/** A limpeza da abertura vale uma vez por semana (feita ou perguntada). */
export function isCleanupDue(s: BackupCleanupState, now = Date.now()): boolean {
  const last = Math.max(s.lastRunAt ? Date.parse(s.lastRunAt) : 0, s.lastAskedAt ? Date.parse(s.lastAskedAt) : 0);
  return now - last >= BACKUP_MAX_AGE_DAYS * DAY;
}

export async function listBackupFiles(handle: FileSystemDirectoryHandle): Promise<BackupFileInfo[]> {
  const out: BackupFileInfo[] = [];
  for await (const [name, entry] of (handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (entry.kind !== "file" || !isDbBackupFile(name)) continue;
    const f = await (entry as FileSystemFileHandle).getFile();
    out.push({ name, lastModified: f.lastModified, size: f.size });
  }
  return out;
}

/** Apaga os arquivos e registra a limpeza. Devolve quantos saíram. */
export async function deleteBackups(handle: FileSystemDirectoryHandle, files: BackupFileInfo[]): Promise<number> {
  let n = 0;
  for (const f of files) {
    try {
      await handle.removeEntry(f.name);
      n++;
    } catch {
      // Arquivo já apagado ou em uso: fica para a próxima.
    }
  }
  await saveCleanupState({ lastRunAt: new Date(Date.now()).toISOString() });
  return n;
}

export type CleanupCheck = { status: "skipped" } | { status: "ask"; handle: PermissionedDirectoryHandle; files: BackupFileInfo[] };

/**
 * Na abertura do CRM: se já passou uma semana da última limpeza (ou pergunta),
 * lista os backups antigos. Sem pasta ou sem autorização, fica para a próxima.
 */
export async function checkBackupCleanup(now = Date.now()): Promise<CleanupCheck> {
  if (!isCleanupDue(await loadCleanupState(), now)) return { status: "skipped" };
  const handle = await loadBackupFolderHandle();
  if (!handle || (await handle.queryPermission({ mode: "readwrite" })) !== "granted") return { status: "skipped" };
  const files = oldBackups(await listBackupFiles(handle), now);
  if (!files.length) {
    await saveCleanupState({ lastRunAt: new Date(now).toISOString() });
    return { status: "skipped" };
  }
  return { status: "ask", handle, files };
}
