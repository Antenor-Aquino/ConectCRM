// Abre o banco a partir de um snapshot (ou vazio), aplica migrations e
// prepara o workspace. Também valida arquivos de backup antes de restaurar.
import type { SqlJsStatic } from "sql.js";
import { bootstrap } from "./bootstrap";
import { seedDemoData } from "./demoData";
import { runMigrations } from "./migrate";
import { one, type DatabaseSync } from "./sql";

export function openDatabase(SQL: SqlJsStatic, bytes: Uint8Array | null, opts: { seedDemo?: boolean } = {}): { db: DatabaseSync; workspaceId: string } {
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const isNew = !one(db, "SELECT 1 FROM workspace LIMIT 1");
  const workspaceId = bootstrap(db);
  if (isNew && opts.seedDemo) seedDemoData(db, workspaceId);
  return { db, workspaceId };
}

/** Confere se os bytes são um backup do ConectCRM (e não outro SQLite). */
export function validateBackup(SQL: SqlJsStatic, bytes: Uint8Array): void {
  let db: DatabaseSync | null = null;
  try {
    db = new SQL.Database(bytes);
    const r = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('deal', 'pipeline', 'workspace')");
    if (r?.n !== 3) throw new Error("not-conectcrm");
  } catch {
    throw new Error("Arquivo inválido: não é um backup do ConectCRM.");
  } finally {
    db?.close();
  }
}
