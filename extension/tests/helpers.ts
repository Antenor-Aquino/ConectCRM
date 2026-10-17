import initSqlJs from "sql.js";
import { createRequire } from "node:module";
import { bootstrap } from "../src/db/bootstrap";
import { runMigrations } from "../src/db/migrate";
import type { DbContext } from "../src/db/repo";
import type { DatabaseSync } from "../src/db/sql";

const require = createRequire(import.meta.url);

/** Banco em memória com migrations e dados iniciais - igual ao offscreen. */
export async function freshDb(): Promise<{ db: DatabaseSync; ctx: DbContext }> {
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const workspaceId = bootstrap(db);
  return { db, ctx: { workspaceId, userId: null } };
}
