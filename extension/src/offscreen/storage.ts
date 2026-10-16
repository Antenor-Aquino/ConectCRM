// Snapshot do SQLite no IndexedDB da extensão (mesma abordagem da
// gestao-financeira-extensao). Só o documento offscreen usa isto.
import type { DbEnv } from "../lib/environment";

const DB_NAME = "conectcrm-storage";
const STORE = "sqlite";
const ACTIVE_ENV_KEY = "ambiente-ativo";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSnapshot(env: string): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(STORE, "readonly").objectStore(STORE).get(env);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Grava (ou, com null, apaga) o snapshot da chave. */
export async function saveSnapshot(env: string, bytes: Uint8Array | null): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite");
    if (bytes) tx.objectStore(STORE).put(bytes, env);
    else tx.objectStore(STORE).delete(env);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadActiveEnv(): Promise<DbEnv> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(STORE, "readonly").objectStore(STORE).get(ACTIVE_ENV_KEY);
    req.onsuccess = () => resolve(req.result === "demo" ? "demo" : "production");
    req.onerror = () => reject(req.error);
  });
}

export async function saveActiveEnv(env: DbEnv): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(env, ACTIVE_ENV_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
