import type { DatabaseSync } from "./sql";
import migration0000 from "./migrations/0000_init.sql?raw";
import migration0001 from "./migrations/0001_activity_meeting_reminder.sql?raw";
import migration0002 from "./migrations/0002_pipeline_card_fields.sql?raw";
import migration0003 from "./migrations/0003_activity_end.sql?raw";
import migration0004 from "./migrations/0004_tag_activity.sql?raw";
import migration0005 from "./migrations/0005_ged.sql?raw";
import migration0006 from "./migrations/0006_note_documents.sql?raw";
import migration0007 from "./migrations/0007_tipo_prazo_final.sql?raw";
import migration0008 from "./migrations/0008_indice_atividade_cartao.sql?raw";
import migration0009 from "./migrations/0009_indices_volume.sql?raw";
import migration0010 from "./migrations/0010_numero_ticket.sql?raw";
import migration0011 from "./migrations/0011_vinculo_externo.sql?raw";
import migration0012 from "./migrations/0012_categorias_campos.sql?raw";
import migration0013 from "./migrations/0013_arquivar_cartao.sql?raw";
import migration0014 from "./migrations/0014_lembretes_notificacoes.sql?raw";

export const MIGRATIONS: { name: string; sql: string }[] = [
  { name: "0000_init.sql", sql: migration0000 },
  { name: "0001_activity_meeting_reminder.sql", sql: migration0001 },
  { name: "0002_pipeline_card_fields.sql", sql: migration0002 },
  { name: "0003_activity_end.sql", sql: migration0003 },
  { name: "0004_tag_activity.sql", sql: migration0004 },
  { name: "0005_ged.sql", sql: migration0005 },
  { name: "0006_note_documents.sql", sql: migration0006 },
  { name: "0007_tipo_prazo_final.sql", sql: migration0007 },
  { name: "0008_indice_atividade_cartao.sql", sql: migration0008 },
  { name: "0009_indices_volume.sql", sql: migration0009 },
  { name: "0010_numero_ticket.sql", sql: migration0010 },
  { name: "0011_vinculo_externo.sql", sql: migration0011 },
  { name: "0012_categorias_campos.sql", sql: migration0012 },
  { name: "0013_arquivar_cartao.sql", sql: migration0013 },
  { name: "0014_lembretes_notificacoes.sql", sql: migration0014 },
];

/** Aplica as migrations pendentes; devolve quantas rodaram. */
export function runMigrations(db: DatabaseSync): number {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  const applied = new Set(db.exec("SELECT name FROM _migrations")[0]?.values.map((v) => v[0] as string) ?? []);
  let count = 0;
  for (const { name, sql } of MIGRATIONS) {
    if (applied.has(name)) continue;
    // Migrations que refazem tabelas (ex.: mudar um CHECK) marcam
    // "-- foreign_keys: off": o PRAGMA só vale fora da transação, e as chaves
    // são conferidas antes do COMMIT.
    const fkOff = sql.startsWith("-- foreign_keys: off");
    const fkWasOn = fkOff && db.exec("PRAGMA foreign_keys")[0]?.values[0]?.[0] === 1;
    if (fkOff) db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      if (fkOff && db.exec("PRAGMA foreign_key_check").length) throw new Error(`Migração ${name}: chaves estrangeiras inválidas.`);
      db.run("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", [name, new Date().toISOString()]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    } finally {
      if (fkWasOn) db.exec("PRAGMA foreign_keys = ON");
    }
    count++;
  }
  return count;
}
