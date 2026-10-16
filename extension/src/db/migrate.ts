import type { DatabaseSync } from "./sql";
import migration0000 from "./migrations/0000_init.sql?raw";

export const MIGRATIONS: { name: string; sql: string }[] = [{ name: "0000_init.sql", sql: migration0000 }];

/** Aplica as migrations pendentes; devolve quantas rodaram. */
export function runMigrations(db: DatabaseSync): number {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const applied = new Set(db.exec("SELECT name FROM _migrations")[0]?.values.map((v) => v[0] as string) ?? []);
  let count = 0;
  for (const { name, sql } of MIGRATIONS) {
    if (applied.has(name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.run("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", [name, new Date().toISOString()]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    count++;
  }
  return count;
}
