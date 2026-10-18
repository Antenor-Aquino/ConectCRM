import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { bootstrap } from "../src/db/bootstrap";
import { runMigrations } from "../src/db/migrate";
import type { DbContext } from "../src/db/repo";
import type { DatabaseSync } from "../src/db/sql";
import { memoryDb } from "../src/db/sqliteDb";

let engine: Promise<Sqlite3Static> | null = null;
/** O mesmo SQLite do navegador (aqui só em memória). */
export const sqlite = (): Promise<Sqlite3Static> => (engine ??= sqlite3InitModule());

/** Banco em memória vazio (sem migrations). */
export const emptyDb = async (): Promise<DatabaseSync> => memoryDb(await sqlite());


/** Banco em memória com migrations e dados iniciais - igual ao offscreen. */
export async function freshDb(): Promise<{ db: DatabaseSync; ctx: DbContext }> {
  const db = await emptyDb();
  db.run("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const workspaceId = bootstrap(db);
  return { db, ctx: { workspaceId, userId: null } };
}
