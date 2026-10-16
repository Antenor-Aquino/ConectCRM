// Documento offscreen: único dono do banco SQLite (PLANEJAMENTO.md, seção 4).
// Dashboard, popup e service worker falam com ele por mensagens; assim duas
// telas abertas nunca sobrescrevem o snapshot uma da outra.
import initSqlJs from "sql.js";
import { bootstrap } from "../db/bootstrap";
import { runMigrations } from "../db/migrate";
import { setWriteListener, type DatabaseSync } from "../db/sql";
import { methods } from "../rpc/methods";
import type { RpcRequest, RpcResponse } from "../rpc/protocol";
import { loadSnapshot, saveSnapshot, type DbEnv } from "./storage";

const env: DbEnv = "production";

async function openDb(): Promise<{ db: DatabaseSync; workspaceId: string }> {
  // Os bytes do .wasm são buscados manualmente (locateFile falha em
  // chrome-extension://, ver gestao-financeira-extensao/src/db/client.ts).
  const res = await fetch(chrome.runtime.getURL("sql-wasm.wasm"));
  if (!res.ok) throw new Error(`Falha ao buscar sql-wasm.wasm: HTTP ${res.status}`);
  const SQL = await initSqlJs({ wasmBinary: await res.arrayBuffer() });
  const snapshot = await loadSnapshot(env);
  const db = snapshot ? new SQL.Database(snapshot) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const workspaceId = bootstrap(db);
  await saveSnapshot(env, db.export());

  // Grava o snapshot 300 ms após a última escrita.
  let timer: ReturnType<typeof setTimeout> | null = null;
  setWriteListener((d) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveSnapshot(env, d.export());
    }, 300);
  });
  return { db, workspaceId };
}

const opened = openDb();

chrome.runtime.onMessage.addListener((msg: RpcRequest, _sender, sendResponse: (r: RpcResponse) => void) => {
  if (msg?.target !== "offscreen" || msg.kind !== "rpc") return false;
  opened
    .then(({ db, workspaceId }) => {
      const handler = (methods as Record<string, (...a: unknown[]) => unknown>)[msg.method];
      if (!handler) throw new Error(`Operação desconhecida: ${msg.method}`);
      sendResponse({ ok: true, result: handler(db, { workspaceId, userId: msg.userId }, msg.params) });
    })
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});
