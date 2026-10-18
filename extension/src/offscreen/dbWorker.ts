// Worker do banco: único dono do SQLite. O banco fica num arquivo no OPFS
// (sistema de arquivos privado da extensão) pela VFS "opfs-sahpool" do SQLite
// oficial: cada transação grava só as páginas alteradas, direto no disco.
// Antes (até 0.2.22) o banco inteiro ficava na memória e era regravado no
// IndexedDB a cada alteração; na primeira abertura esse snapshot é importado.
//
// O documento offscreen repassa as mensagens das telas para cá (o OPFS
// síncrono só existe em workers).
import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { finishLegacyBlob, legacyBlobs, legacyBytes } from "../db/documents";
import { prepareDatabase, validateBackup } from "../db/open";
import type { DatabaseSync } from "../db/sql";
import { SqliteDb } from "../db/sqliteDb";
import { errorText } from "../lib/errors";
import { base64ToBytes, bytesToBase64, type DbEnv } from "../lib/environment";
import { clearBrowser, putInBrowser, sha256Hex } from "../lib/fileStore";
import { methods } from "../rpc/methods";
import { loadActiveEnv, loadSnapshot, saveActiveEnv, saveSnapshot } from "./storage";

type Pool = Awaited<ReturnType<Sqlite3Static["installOpfsSAHPoolVfs"]>>;

export interface WorkerRequest {
  id: number;
  method: string;
  params: unknown;
  userId: string | null;
}
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

interface State {
  db: DatabaseSync;
  workspaceId: string;
  env: DbEnv;
}

const fileOf = (env: string) => `/${env}.sqlite3`;

/** O pool só aceita um dono: se o worker anterior ainda solta os arquivos, tenta de novo. */
async function installPool(sqlite3: Sqlite3Static): Promise<Pool> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({ name: "conectcrm", directory: ".conectcrm-db", initialCapacity: 8 });
    } catch (err) {
      if (attempt >= 20) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

const engine = (async () => {
  const sqlite3 = await sqlite3InitModule();
  return { sqlite3, pool: await installPool(sqlite3) };
})();

/** Snapshot antigo (IndexedDB) → arquivo no OPFS, uma vez. O snapshot fica guardado como "<env>-legado". */
async function importLegacy(pool: Pool, env: DbEnv): Promise<void> {
  if (pool.getFileNames().includes(fileOf(env))) return;
  const bytes = await loadSnapshot(env);
  if (!bytes?.length) return;
  await pool.importDb(fileOf(env), bytes);
  await saveSnapshot(`${env}-legado`, bytes);
  await saveSnapshot(env, null);
}

async function open(env: DbEnv): Promise<State> {
  const { sqlite3, pool } = await engine;
  await importLegacy(pool, env);
  const db = new SqliteDb(sqlite3, new pool.OpfsSAHPoolDb(fileOf(env)));
  // Cache maior (32 MB) para bases grandes; o resto fica no disco.
  db.run("PRAGMA cache_size = -32000");
  const { workspaceId } = prepareDatabase(db, { seedDemo: env === "demo" });
  const st = { db, workspaceId, env };
  await moveLegacyFiles(st);
  return st;
}

/** Anexos antigos (antes do GED): o conteúdo sai do banco para o depósito. */
async function moveLegacyFiles(st: State): Promise<void> {
  const ctx = { workspaceId: st.workspaceId, userId: null };
  for (const b of legacyBlobs(st.db)) {
    try {
      const bytes = legacyBytes(st.db, b.id);
      if (!bytes) continue;
      const sha = await sha256Hex(bytes);
      await putInBrowser(st.env, sha, new Blob([bytes as BlobPart], { type: b.mime }));
      finishLegacyBlob(st.db, ctx, b.id, sha);
    } catch (err) {
      // Continua no banco e é lido de lá; tenta de novo na próxima abertura.
      console.warn("ConectCRM: anexo antigo não mudou para o depósito", b.id, err);
    }
  }
}

let opened: Promise<State> = loadActiveEnv().then(open);

/** Backups em trânsito (exportação ou restauração em partes). */
const CHUNK = 16 * 1024 * 1024;
const transfers = new Map<string, { bytes: Uint8Array; size: number }>();

/** Operações do próprio worker (não passam pelo registro de métodos). */
async function system(method: string, params: Record<string, unknown>): Promise<unknown> {
  const st = await opened;
  const { sqlite3, pool } = await engine;
  switch (method) {
    case "system.env":
      return st.env;
    // Backup em partes: as mensagens entre páginas da extensão têm limite de
    // 64 MB, e o banco pode ser bem maior.
    case "system.exportBegin": {
      const token = crypto.randomUUID();
      const bytes = st.db.export();
      transfers.set(token, { bytes, size: bytes.length });
      return { token, size: bytes.length };
    }
    case "system.exportChunk": {
      const t = transfers.get(String(params.token));
      if (!t) throw new Error("Exportação expirada. Tente de novo.");
      const offset = Number(params.offset);
      const part = t.bytes.subarray(offset, offset + CHUNK);
      if (offset + part.length >= t.size) transfers.delete(String(params.token));
      return bytesToBase64(part);
    }
    case "system.restoreBegin": {
      const size = Number(params.size);
      if (!(size > 0)) throw new Error("Arquivo vazio.");
      const token = crypto.randomUUID();
      transfers.set(token, { bytes: new Uint8Array(size), size: 0 });
      return token;
    }
    case "system.restoreChunk": {
      const t = transfers.get(String(params.token));
      if (!t) throw new Error("Restauração expirada. Tente de novo.");
      const part = base64ToBytes(String(params.base64));
      if (t.size + part.length > t.bytes.length) throw new Error("Arquivo maior que o informado.");
      t.bytes.set(part, t.size);
      t.size += part.length;
      return t.size;
    }
    case "system.switchEnv": {
      const env = params.env as DbEnv;
      if (env !== "production" && env !== "demo") throw new Error("Ambiente inválido.");
      st.db.close();
      await saveActiveEnv(env);
      opened = open(env);
      await opened;
      return env;
    }
    case "system.resetDemo": {
      if (st.env !== "demo") throw new Error("Só o ambiente de Teste pode ser recriado.");
      st.db.close();
      pool.unlink(fileOf("demo"));
      await clearBrowser("demo");
      opened = open("demo");
      await opened;
      return true;
    }
    case "system.restore": {
      const t = transfers.get(String(params.token));
      transfers.delete(String(params.token));
      if (!t || t.size !== t.bytes.length) throw new Error("Restauração incompleta. Tente de novo.");
      const bytes = t.bytes;
      validateBackup(sqlite3, bytes);
      // Guarda o banco atual antes de substituir (desfazer manual em caso de engano).
      await pool.importDb(fileOf(`${st.env}-antes-da-restauracao`), st.db.export());
      st.db.close();
      await pool.importDb(fileOf(st.env), bytes);
      opened = open(st.env);
      await opened;
      return true;
    }
    default:
      throw new Error(`Operação desconhecida: ${method}`);
  }
}

const SYSTEM = new Set([
  "system.env",
  "system.exportBegin",
  "system.exportChunk",
  "system.restoreBegin",
  "system.restoreChunk",
  "system.restore",
  "system.switchEnv",
  "system.resetDemo",
]);

// As operações de sistema fecham e reabrem o banco: uma por vez.
let systemQueue: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, method, params, userId } = e.data;
  let job: Promise<unknown>;
  if (SYSTEM.has(method)) {
    job = systemQueue.then(() => system(method, (params ?? {}) as Record<string, unknown>));
    systemQueue = job.catch(() => undefined);
  } else {
    job = opened.then(({ db, workspaceId }) => {
      const handler = (methods as Record<string, (...a: unknown[]) => unknown>)[method];
      if (!handler) throw new Error(`Operação desconhecida: ${method}`);
      // Algumas operações são assíncronas (ex.: hash do PIN).
      return Promise.resolve(handler(db, { workspaceId, userId }, params));
    });
  }
  job
    .then((result) => postMessage({ id, ok: true, result } satisfies WorkerResponse))
    .catch((err: unknown) => postMessage({ id, ok: false, error: errorText(err) } satisfies WorkerResponse));
};
