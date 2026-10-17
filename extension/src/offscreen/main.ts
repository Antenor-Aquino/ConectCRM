// Documento offscreen: único dono do banco SQLite (PLANEJAMENTO.md, seção 4).
// Dashboard, popup e service worker falam com ele por mensagens; assim duas
// telas abertas nunca sobrescrevem o snapshot uma da outra.
// Também troca de ambiente (Produção/Teste), exporta e restaura backups.
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { openDatabase, validateBackup } from "../db/open";
import { setWriteListener, type DatabaseSync } from "../db/sql";
import { base64ToBytes, bytesToBase64, type DbEnv } from "../lib/environment";
import { methods } from "../rpc/methods";
import type { RpcRequest, RpcResponse } from "../rpc/protocol";
import { loadActiveEnv, loadSnapshot, saveActiveEnv, saveSnapshot } from "./storage";

interface State {
  db: DatabaseSync;
  workspaceId: string;
  env: DbEnv;
}

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  // Os bytes do .wasm são buscados manualmente (locateFile falha em
  // chrome-extension://, ver gestao-financeira-extensao/src/db/client.ts).
  sqlPromise ??= fetch(chrome.runtime.getURL("sql-wasm.wasm"))
    .then((res) => {
      if (!res.ok) throw new Error(`Falha ao buscar sql-wasm.wasm: HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((wasmBinary) => initSqlJs({ wasmBinary }));
  return sqlPromise;
}

// Grava o snapshot 300 ms após a última escrita. Cada banco aberto sabe o seu
// ambiente; escritas de um banco ainda abrindo (migrations, dados de exemplo)
// são ignoradas, pois open() grava o snapshot logo em seguida.
let timer: ReturnType<typeof setTimeout> | null = null;
let current: State | null = null;
const envOf = new WeakMap<DatabaseSync, DbEnv>();
setWriteListener((d) => {
  const env = envOf.get(d);
  if (!env) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void saveSnapshot(env, d.export());
  }, 300);
});

async function flush(): Promise<void> {
  if (timer && current) {
    clearTimeout(timer);
    timer = null;
    await saveSnapshot(current.env, current.db.export());
  }
}

async function open(env: DbEnv): Promise<State> {
  const SQL = await getSql();
  const { db, workspaceId } = openDatabase(SQL, await loadSnapshot(env), { seedDemo: env === "demo" });
  await saveSnapshot(env, db.export());
  envOf.set(db, env);
  current = { db, workspaceId, env };
  return current;
}

let opened: Promise<State> = loadActiveEnv().then(open);

/** Operações do próprio offscreen (não passam pelo registro de métodos). */
async function system(method: string, params: Record<string, unknown>): Promise<unknown> {
  const st = await opened;
  switch (method) {
    case "system.env":
      return st.env;
    case "system.export":
      await flush();
      return bytesToBase64(st.db.export());
    case "system.switchEnv": {
      const env = params.env as DbEnv;
      if (env !== "production" && env !== "demo") throw new Error("Ambiente inválido.");
      await flush();
      st.db.close();
      await saveActiveEnv(env);
      opened = open(env);
      await opened;
      return env;
    }
    case "system.resetDemo": {
      if (st.env !== "demo") throw new Error("Só o ambiente de Teste pode ser recriado.");
      await flush();
      st.db.close();
      await saveSnapshot("demo", null);
      opened = open("demo");
      await opened;
      return true;
    }
    case "system.restore": {
      const SQL = await getSql();
      const bytes = base64ToBytes(String(params.base64));
      validateBackup(SQL, bytes);
      await flush();
      // Guarda o banco atual antes de substituir (desfazer manual em caso de engano).
      await saveSnapshot(`${st.env}-antes-da-restauracao`, st.db.export());
      st.db.close();
      const restored = openDatabase(SQL, bytes);
      await saveSnapshot(st.env, restored.db.export());
      envOf.set(restored.db, st.env);
      current = { ...restored, env: st.env };
      opened = Promise.resolve(current);
      return true;
    }
    default:
      throw new Error(`Operação desconhecida: ${method}`);
  }
}

const SYSTEM = new Set(["system.env", "system.export", "system.switchEnv", "system.resetDemo", "system.restore"]);

chrome.runtime.onMessage.addListener((msg: RpcRequest, _sender, sendResponse: (r: RpcResponse) => void) => {
  if (msg?.target !== "offscreen" || msg.kind !== "rpc") return false;
  const run = SYSTEM.has(msg.method)
    ? system(msg.method, (msg.params ?? {}) as Record<string, unknown>)
    : opened.then(({ db, workspaceId }) => {
        const handler = (methods as Record<string, (...a: unknown[]) => unknown>)[msg.method];
        if (!handler) throw new Error(`Operação desconhecida: ${msg.method}`);
        // Algumas operações são assíncronas (ex.: hash do PIN).
        return Promise.resolve(handler(db, { workspaceId, userId: msg.userId }, msg.params));
      });
  run
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});
