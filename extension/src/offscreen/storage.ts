// Snapshot do SQLite no IndexedDB da extensão (mesma abordagem da
// gestao-financeira-extensao). Só o documento offscreen usa isto.
const DB_NAME = "conectcrm-storage";
const STORE = "sqlite";
export type DbEnv = "production" | "demo";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot(env: DbEnv): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(STORE, "readonly").objectStore(STORE).get(env);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(env: DbEnv, bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(bytes, env);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
