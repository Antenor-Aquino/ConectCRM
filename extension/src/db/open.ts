// Prepara um banco já aberto (migrations, workspace, dados de exemplo) e
// valida arquivos de backup antes de restaurar.
import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { bootstrap } from "./bootstrap";
import { seedDemoData } from "./demoData";
import { runMigrations } from "./migrate";
import { one, type DatabaseSync } from "./sql";
import { memoryDb } from "./sqliteDb";

export function prepareDatabase(db: DatabaseSync, opts: { seedDemo?: boolean } = {}): { db: DatabaseSync; workspaceId: string } {
  db.run("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const isNew = !one(db, "SELECT 1 FROM workspace LIMIT 1");
  const workspaceId = bootstrap(db);
  if (isNew && opts.seedDemo) seedDemoData(db, workspaceId);
  return { db, workspaceId };
}

/** Banco em memória a partir de bytes (ou vazio), já preparado. */
export function openDatabase(sqlite3: Sqlite3Static, bytes: Uint8Array | null, opts: { seedDemo?: boolean } = {}): { db: DatabaseSync; workspaceId: string } {
  return prepareDatabase(memoryDb(sqlite3, bytes), opts);
}

/** Confere se os bytes são um backup do ConectCRM (e não outro SQLite). */
export function validateBackup(sqlite3: Sqlite3Static, bytes: Uint8Array): void {
  let db: DatabaseSync | null = null;
  try {
    db = memoryDb(sqlite3, bytes);
    const r = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('deal', 'pipeline', 'workspace')");
    if (r?.n !== 3) throw new Error("not-conectcrm");
  } catch {
    throw new Error("Arquivo inválido: não é um backup do ConectCRM.");
  } finally {
    db?.close();
  }
}
