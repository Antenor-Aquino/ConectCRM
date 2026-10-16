// Pasta de backup (File System Access API): o handle fica num IndexedDB
// próprio, porque não é serializável em chrome.storage (mesma solução da
// gestao-financeira-extensao).
const DB_NAME = "conectcrm-backup-folder";
const STORE = "handle";
const KEY = "dir";

export interface PermissionedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite"; id?: string }) => Promise<PermissionedDirectoryHandle>;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBackupFolderHandle(handle: PermissionedDirectoryHandle): Promise<void> {
  const idb = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadBackupFolderHandle(): Promise<PermissionedDirectoryHandle | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as PermissionedDirectoryHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function pickBackupFolder(): Promise<PermissionedDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("Este navegador não permite escolher pasta. Use o Chrome atualizado.");
  const handle = await picker({ mode: "readwrite", id: "conectcrm-backup" });
  await saveBackupFolderHandle(handle);
  return handle;
}
