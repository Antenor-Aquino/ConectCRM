// Backup automático (mesma lógica da gestao-financeira-extensao): a checagem
// roda quando o CRM é aberto (a File System Access API precisa de uma página,
// não funciona no service worker). Na primeira abertura do dia (ou da semana)
// grava uma cópia do banco na pasta escolhida.
import { addNotification } from "./notifications";
import { loadBackupFolderHandle, type PermissionedDirectoryHandle } from "./backupFolder";
import { errorText } from "./errors";
import { exportSettings, SETTINGS_BACKUP_FILE, settingsJson } from "./settingsTransfer";

export type BackupFrequency = "daily" | "weekly";

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: BackupFrequency;
  lastRunAt: string | null;
  folderName: string | null;
  /** Quantos backups automáticos manter (0 = todos). Os mais antigos são apagados da pasta. */
  keepDaily: number;
  keepWeekly: number;
}

const KEY = "conectcrm-auto-backup";
const DEFAULTS: AutoBackupSettings = { enabled: false, frequency: "daily", lastRunAt: null, folderName: null, keepDaily: 0, keepWeekly: 0 };

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

const AUTO_PREFIX = { daily: "diario_conectcrm-backup-auto-", weekly: "Semanal_conectcrm-backup-auto-" } as const;

/** Quais backups automáticos apagar para ficar só com os `keep` mais recentes (0 = guarda todos). */
export function backupsToPrune(names: string[], frequency: BackupFrequency, keep: number): string[] {
  if (!keep) return [];
  const mine = names.filter((n) => n.startsWith(AUTO_PREFIX[frequency]) && n.endsWith(".sqlite")).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}

/** Apaga da pasta os backups automáticos além do limite (os manuais nunca são apagados). */
export async function pruneBackups(handle: FileSystemDirectoryHandle, settings: Pick<AutoBackupSettings, "keepDaily" | "keepWeekly">): Promise<number> {
  if (!settings.keepDaily && !settings.keepWeekly) return 0;
  const names: string[] = [];
  for await (const n of (handle as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(n);
  const drop = [...backupsToPrune(names, "daily", settings.keepDaily), ...backupsToPrune(names, "weekly", settings.keepWeekly)];
  for (const n of drop) await handle.removeEntry(n).catch(() => {});
  return drop.length;
}

async function writeSettingsCopy(handle: FileSystemDirectoryHandle): Promise<void> {
  const w = await (await handle.getFileHandle(SETTINGS_BACKUP_FILE, { create: true })).createWritable();
  await w.write(new Blob([settingsJson(await exportSettings(false))], { type: "application/json" }));
  await w.close();
}

/** Grava o arquivo na pasta e registra a data (backup automático ou "Fazer backup agora").
 * Os documentos do GED têm backup próprio (lib/docBackup). */
export async function writeBackup(
  getBytes: () => Promise<Uint8Array>,
  handle: PermissionedDirectoryHandle,
  settings: AutoBackupSettings,
  filename = autoBackupFilename(settings.frequency),
): Promise<string> {
  const bytes = await getBytes();
  const file = await handle.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/x-sqlite3" }));
  await writable.close();
  // Configurações fora do banco (sem senhas e chaves), sempre a mais recente.
  await writeSettingsCopy(handle).catch(() => {});
  const pruned = await pruneBackups(handle, settings).catch(() => 0);
  await saveAutoBackupSettings({ ...settings, lastRunAt: new Date().toISOString(), folderName: handle.name });
  await addNotification({
    kind: "success",
    title: "Backup concluído",
    message: `Salvo em "${handle.name}/${filename}".${pruned ? ` ${pruned} backup(s) automático(s) antigo(s) apagado(s) (limite de retenção).` : ""}`,
  });
  return filename;
}

export type AutoBackupCheck =
  | { status: "skipped" }
  | { status: "done" }
  | { status: "needs-permission"; handle: PermissionedDirectoryHandle; settings: AutoBackupSettings }
  | { status: "error"; message: string };

/** Chamada ao abrir o CRM. Sem permissão (o Chrome pede de novo após reiniciar),
 * devolve "needs-permission" para a tela pedir a autorização com um clique. */
export async function checkAutoBackup(getBytes: () => Promise<Uint8Array>): Promise<AutoBackupCheck> {
  const settings = await loadAutoBackupSettings();
  if (!settings.enabled || !isBackupDue(settings.frequency, settings.lastRunAt)) return { status: "skipped" };
  const handle = await loadBackupFolderHandle();
  if (!handle) return { status: "skipped" };
  if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") return { status: "needs-permission", handle, settings };
  try {
    await writeBackup(getBytes, handle, settings);
    return { status: "done" };
  } catch (err) {
    const message = errorText(err);
    await addNotification({ kind: "error", title: "Backup automático falhou", message });
    return { status: "error", message };
  }
}
