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

/** "dir" = pasta do backup do banco; "docs" = pasta própria do backup dos documentos. */
type FolderKey = typeof KEY | "docs";

export async function saveBackupFolderHandle(handle: PermissionedDirectoryHandle | null, key: FolderKey = KEY): Promise<void> {
  const idb = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite");
    if (handle) tx.objectStore(STORE).put(handle, key);
    else tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadBackupFolderHandle(key: FolderKey = KEY): Promise<PermissionedDirectoryHandle | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as PermissionedDirectoryHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function pickBackupFolder(key: FolderKey = KEY): Promise<PermissionedDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("Este navegador não permite escolher pasta. Use o Chrome atualizado.");
  const handle = await picker({ mode: "readwrite", id: key === KEY ? "conectcrm-backup" : "conectcrm-backup-docs" });
  await saveBackupFolderHandle(handle, key);
  return handle;
}
