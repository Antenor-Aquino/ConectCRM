-- foreign_keys: off
-- Tags de tarefa: a tabela tag tinha CHECK só com as entidades antigas. O
-- SQLite não altera CHECK, então a tabela é refeita (procedimento padrão:
-- nova tabela, copia, apaga a antiga, renomeia), com as chaves estrangeiras
-- desligadas e conferidas no fim (ver migrate.ts).
CREATE TABLE tag_new (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity        TEXT NOT NULL CHECK (entity IN ('person', 'organization', 'deal', 'ticket', 'project', 'activity')),
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT 'slate',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
INSERT INTO tag_new SELECT id, workspace_id, entity, name, color, active, created_at, created_by, updated_at, updated_by, deleted_at, version FROM tag;
DROP TABLE tag;
ALTER TABLE tag_new RENAME TO tag;
CREATE UNIQUE INDEX tag_name ON tag(workspace_id, entity, name COLLATE NOCASE) WHERE deleted_at IS NULL;
