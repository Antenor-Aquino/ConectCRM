// Backup automático (mesma lógica da gestao-financeira-extensao): a checagem
// roda quando o CRM é aberto (a File System Access API precisa de uma página,
// não funciona no service worker). Na primeira abertura do dia (ou da semana)
// grava uma cópia do banco na pasta escolhida.
import { addNotification } from "./notifications";
import { loadBackupFolderHandle, type PermissionedDirectoryHandle } from "./backupFolder";

export type BackupFrequency = "daily" | "weekly";

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: BackupFrequency;
  lastRunAt: string | null;
  folderName: string | null;
}

const KEY = "conectcrm-auto-backup";
const DEFAULTS: AutoBackupSettings = { enabled: false, frequency: "daily", lastRunAt: null, folderName: null };

export async function loadAutoBackupSettings(): Promise<AutoBackupSettings> {
  return { ...DEFAULTS, ...((await chrome.storage.local.get(KEY))[KEY] as Partial<AutoBackupSettings> | undefined) };
}

export async function saveAutoBackupSettings(s: AutoBackupSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

// Dia no fuso LOCAL - nunca toISOString().slice(0,10), que no Brasil vira o
// dia seguinte a partir das 21h (bug já corrigido na financeira).
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localTimestamp(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${localDateKey(d)}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}Z`;
}

/** Nome no horário LOCAL; o "Z" é só parte do padrão de nome (não indica UTC). */
export function autoBackupFilename(frequency: BackupFrequency, now: Date = new Date()): string {
  const stamp = localTimestamp(now);
  if (frequency === "daily") return `diario_conectcrm-backup-auto-${stamp}.sqlite`;
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const saturday = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + 6);
  return `Semanal_conectcrm-backup-auto-${localDateKey(sunday)}_${localDateKey(saturday)}T${stamp.split("T")[1]}.sqlite`;
}

export function manualBackupFilename(now: Date = new Date()): string {
  return `conectcrm-backup-${localTimestamp(now)}.sqlite`;
}

function startOfWeekKey(d: Date): string {
  const diff = (d.getDay() === 0 ? -6 : 1) - d.getDay();
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff));
}

export function isBackupDue(frequency: BackupFrequency, lastRunAt: string | null, now: Date = new Date()): boolean {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  return frequency === "daily" ? localDateKey(now) !== localDateKey(last) : startOfWeekKey(now) !== startOfWeekKey(last);
}

/** Grava o arquivo na pasta e registra a data (backup automático ou "Fazer backup agora"). */
export async function writeBackup(
  getBytes: () => Promise<Uint8Array>,
  handle: PermissionedDirectoryHandle,
  settings: AutoBackupSettings,
  filename = autoBackupFilename(settings.frequency),
  /** Copia também os documentos do GED (devolve um resumo para o aviso). */
  saveDocuments?: (handle: PermissionedDirectoryHandle) => Promise<string | null>,
): Promise<string> {
  const bytes = await getBytes();
  const file = await handle.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/x-sqlite3" }));
  await writable.close();
  const docs = saveDocuments ? await saveDocuments(handle) : null;
  await saveAutoBackupSettings({ ...settings, lastRunAt: new Date().toISOString(), folderName: handle.name });
  await addNotification({ kind: "success", title: "Backup concluído", message: `Salvo em "${handle.name}/${filename}".${docs ? ` ${docs}` : ""}` });
  return filename;
}

export type AutoBackupCheck =
  | { status: "skipped" }
  | { status: "done" }
  | { status: "needs-permission"; handle: PermissionedDirectoryHandle; settings: AutoBackupSettings }
  | { status: "error"; message: string };

/** Chamada ao abrir o CRM. Sem permissão (o Chrome pede de novo após reiniciar),
 * devolve "needs-permission" para a tela pedir a autorização com um clique. */
export async function checkAutoBackup(
  getBytes: () => Promise<Uint8Array>,
  saveDocuments?: (handle: PermissionedDirectoryHandle) => Promise<string | null>,
): Promise<AutoBackupCheck> {
  const settings = await loadAutoBackupSettings();
  if (!settings.enabled || !isBackupDue(settings.frequency, settings.lastRunAt)) return { status: "skipped" };
  const handle = await loadBackupFolderHandle();
  if (!handle) return { status: "skipped" };
  if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") return { status: "needs-permission", handle, settings };
  try {
    await writeBackup(getBytes, handle, settings, undefined, saveDocuments);
    return { status: "done" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await addNotification({ kind: "error", title: "Backup automático falhou", message });
    return { status: "error", message };
  }
}
