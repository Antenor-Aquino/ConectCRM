-- Atividades recorrentes (spec 02): a série guarda a regra e o modelo da
-- atividade; as ocorrências são atividades normais (series_id + series_index),
-- criadas para os próximos 60 dias (ou uma por vez, em "repetir só depois de
-- concluir"). skipped = ocorrências excluídas uma a uma (não voltam);
-- stop_index = a série acaba nessa ocorrência ("excluir esta e as próximas").
CREATE TABLE activity_series (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  rule          TEXT NOT NULL,           -- JSON (lib/recurrence.ts)
  start_at      TEXT NOT NULL,           -- início da 1ª ocorrência (ISO)
  from_at       TEXT NOT NULL,           -- só gera ocorrências a partir daqui
  template      TEXT NOT NULL,           -- JSON: campos da atividade
  skipped       TEXT NOT NULL DEFAULT '[]',
  stop_index    INTEGER,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE activity ADD COLUMN series_id TEXT REFERENCES activity_series(id);
ALTER TABLE activity ADD COLUMN series_index INTEGER;
CREATE INDEX activity_series_idx ON activity(series_id, series_index) WHERE deleted_at IS NULL;
