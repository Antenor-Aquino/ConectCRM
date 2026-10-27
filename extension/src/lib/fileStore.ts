// Depósito do conteúdo dos documentos (GED), fora do SQLite: no navegador
// (IndexedDB, um "armário" por ambiente) ou numa pasta do computador
// escolhida em Configurações → Documentos (só Produção). Os arquivos são
// identificados pelo SHA-256 do conteúdo; o banco guarda onde cada um está.
// Usado pelas telas (dashboard, popup) e pelo offscreen (mudança dos anexos
// antigos) - todos na mesma origem chrome-extension://, logo o mesmo IndexedDB.
import type { DbEnv } from "./environment";
import type { DirectoryPickerWindow, PermissionedDirectoryHandle } from "./backupFolder";

const DB_NAME = "conectcrm-files";
const FOLDER_DB = "conectcrm-ged-folder";
const ENVS: DbEnv[] = ["production", "demo"];

function openFilesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const env of ENVS) if (!req.result.objectStoreNames.contains(env)) req.result.createObjectStore(env);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(env: DbEnv, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openFilesDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(env, mode);
        const req = fn(tx.objectStore(env));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error ?? req.error);
      }),
  );
}

export async function sha256Hex(data: Blob | Uint8Array): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Navegador ----------

export function putInBrowser(env: DbEnv, sha256: string, blob: Blob): Promise<void> {
  return idbRequest(env, "readwrite", (s) => s.put(blob, sha256));
}

export function getFromBrowser(env: DbEnv, sha256: string): Promise<Blob | undefined> {
  return idbRequest<Blob | undefined>(env, "readonly", (s) => s.get(sha256));
}

/** O arquivo está no navegador? (sem ler o conteúdo) */
export async function hasInBrowser(env: DbEnv, sha256: string): Promise<boolean> {
  return (await idbRequest<IDBValidKey | undefined>(env, "readonly", (s) => s.getKey(sha256))) !== undefined;
}

export function deleteFromBrowser(env: DbEnv, sha256: string): Promise<void> {
  return idbRequest(env, "readwrite", (s) => s.delete(sha256));
}

/** Apaga todos os arquivos do ambiente (Teste recriado). */
export function clearBrowser(env: DbEnv): Promise<void> {
  return idbRequest(env, "readwrite", (s) => s.clear());
}

// ---------- Pasta escolhida ----------

function openFolderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FOLDER_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handle");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadDocumentsFolder(): Promise<PermissionedDirectoryHandle | null> {
  const db = await openFolderDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("handle", "readonly").objectStore("handle").get("production");
    req.onsuccess = () => resolve((req.result as PermissionedDirectoryHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDocumentsFolder(handle: PermissionedDirectoryHandle | null): Promise<void> {
  const db = await openFolderDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("handle", "readwrite");
    if (handle) tx.objectStore("handle").put(handle, "production");
    else tx.objectStore("handle").delete("production");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Escolher a pasta (precisa de clique do usuário). `confirmPick` pode recusar a escolha antes de gravar. */
export async function pickDocumentsFolder(confirmPick?: (h: PermissionedDirectoryHandle) => boolean): Promise<PermissionedDirectoryHandle | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("Este navegador não permite escolher pasta. Use o Chrome atualizado.");
  const handle = await picker({ mode: "readwrite", id: "conectcrm-documentos" });
  if (confirmPick && !confirmPick(handle)) return null;
  await saveDocumentsFolder(handle);
  return handle;
}

export function forgetDocumentsFolder(): Promise<void> {
  return saveDocumentsFolder(null);
}

export interface FolderStatus {
  configured: boolean;
  name: string | null;
  /** granted = pode ler e gravar; prompt = o Chrome pede confirmação de novo. */
  permission: PermissionState | null;
}

export async function documentsFolderStatus(): Promise<FolderStatus> {
  const h = await loadDocumentsFolder().catch(() => null);
  if (!h) return { configured: false, name: null, permission: null };
  const permission = await h.queryPermission({ mode: "readwrite" }).catch(() => "prompt" as PermissionState);
  return { configured: true, name: h.name, permission };
}

/** Pede de novo o acesso à pasta (precisa de clique do usuário). */
export async function requestDocumentsFolderAccess(): Promise<boolean> {
  const h = await loadDocumentsFolder();
  if (!h) return false;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

export class FolderAccessError extends Error {
  constructor() {
    super('Sem acesso à pasta de documentos. Clique em "Conceder acesso" (Configurações → Documentos).');
  }
}

export async function grantedFolder(): Promise<PermissionedDirectoryHandle | null> {
  const h = await loadDocumentsFolder().catch(() => null);
  if (!h) return null;
  return (await h.queryPermission({ mode: "readwrite" }).catch(() => "denied")) === "granted" ? h : null;
}

function safeName(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "documento"
  );
}

function extensionOf(filename: string): string {
  const m = filename.match(/\.([A-Za-z0-9]{1,8})$/);
  return m ? `.${m[1]!.toLowerCase()}` : "";
}

/** Caminho legível dentro da pasta: AAAA-MM/Nome do documento (abc12345).pdf */
export function folderPath(name: string, filename: string, sha256: string, date = new Date()): string {
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return `${month}/${safeName(name)} (${sha256.slice(0, 8)})${extensionOf(filename)}`;
}

export async function dirFor(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; file: string }> {
  const parts = path.split("/");
  const file = parts.pop()!;
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, file };
}

export async function writeToFolder(root: FileSystemDirectoryHandle, path: string, blob: Blob): Promise<void> {
  const { dir, file } = await dirFor(root, path, true);
  const handle = await dir.getFileHandle(file, { create: true });
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}

// ---------- Operações usadas pelas telas ----------

export interface StoredFile {
  location: "browser" | "folder";
  path: string | null;
}

/** Grava o conteúdo novo: na pasta (Produção com pasta e acesso) ou no navegador. */
export async function storeContent(env: DbEnv, blob: Blob, info: { sha256: string; name: string; filename: string }): Promise<StoredFile> {
  const folder = env === "production" ? await grantedFolder() : null;
  if (folder) {
    const path = folderPath(info.name, info.filename, info.sha256);
    await writeToFolder(folder, path, blob);
    return { location: "folder", path };
  }
  await putInBrowser(env, info.sha256, blob);
  return { location: "browser", path: null };
}

export interface ContentRef {
  sha256: string;
  location: "browser" | "folder" | "legacy";
  path: string | null;
  mime: string;
}

export class MissingFileError extends Error {}

/** Lê o conteúdo de onde estiver. */
export async function readContent(env: DbEnv, ref: ContentRef): Promise<Blob> {
  if (ref.location === "folder" && ref.path) {
    const h = await loadDocumentsFolder().catch(() => null);
    if (!h) throw new MissingFileError("A pasta de documentos não está configurada neste computador.");
    if ((await h.queryPermission({ mode: "readwrite" }).catch(() => "denied")) !== "granted") throw new FolderAccessError();
    try {
      const { dir, file } = await dirFor(h, ref.path, false);
      const f = await (await dir.getFileHandle(file)).getFile();
      return new Blob([f], { type: ref.mime });
    } catch {
      throw new MissingFileError(
        `Arquivo não encontrado na pasta "${h.name}" (${ref.path}). Se a pasta mudou de lugar, use Configurações → Documentos → Localizar documentos.`,
      );
    }
  }
  const blob = await getFromBrowser(env, ref.sha256);
  if (!blob) throw new MissingFileError("Arquivo não encontrado neste navegador. Restaure um backup com os documentos.");
  return blob.type === ref.mime ? blob : new Blob([blob], { type: ref.mime });
}

/** Apaga o conteúdo (arquivo sem nenhum documento). */
export async function deleteContent(env: DbEnv, ref: ContentRef): Promise<void> {
  if (ref.location === "folder" && ref.path) {
    const h = await grantedFolder();
    if (!h) return;
    try {
      const { dir, file } = await dirFor(h, ref.path, false);
      await dir.removeEntry(file);
    } catch {
      // Já não existe.
    }
    return;
  }
  await deleteFromBrowser(env, ref.sha256);
}

/** Muda um arquivo do navegador para a pasta (devolve o caminho). */
export async function moveToFolder(env: DbEnv, ref: { sha256: string; name: string; filename: string; created_at: string }): Promise<string | null> {
  const folder = await grantedFolder();
  const blob = await getFromBrowser(env, ref.sha256);
  if (!folder || !blob) return null;
  const path = folderPath(ref.name, ref.filename, ref.sha256, new Date(ref.created_at));
  await writeToFolder(folder, path, blob);
  await deleteFromBrowser(env, ref.sha256);
  return path;
}

/** Traz um arquivo da pasta de volta para o navegador. */
export async function moveToBrowser(env: DbEnv, ref: ContentRef): Promise<void> {
  const blob = await readContent(env, ref);
  await putInBrowser(env, ref.sha256, blob);
}
