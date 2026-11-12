-- foreign_keys: off
-- GED: documentos também se vinculam a tarefas do To Do (entity_type 'todo').
-- O SQLite não altera CHECK: a tabela é refeita (ver 0004_tag_activity.sql).
CREATE TABLE document_link_new (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  document_id   TEXT NOT NULL REFERENCES document(id),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('person', 'organization', 'deal', 'activity', 'todo')),
  entity_id     TEXT NOT NULL,
  auto          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
INSERT INTO document_link_new SELECT id, workspace_id, document_id, entity_type, entity_id, auto, created_at, created_by, updated_at, updated_by, deleted_at, version FROM document_link;
DROP TABLE document_link;
ALTER TABLE document_link_new RENAME TO document_link;
CREATE UNIQUE INDEX document_link_unique ON document_link(document_id, entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX document_link_entity ON document_link(entity_type, entity_id) WHERE deleted_at IS NULL;
