-- Pastas do GED (spec 05): organização opcional, como no computador. Cada
-- documento fica em no máximo uma pasta (folder_id NULL = "Sem pasta"); a pasta
-- é só organização na tela — o arquivo continua guardado onde estava.
CREATE TABLE document_folder (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  parent_id     TEXT REFERENCES document_folder(id),   -- NULL = na raiz
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
-- Nome não se repete dentro da mesma pasta.
CREATE UNIQUE INDEX document_folder_name ON document_folder(workspace_id, COALESCE(parent_id, ''), name COLLATE NOCASE) WHERE deleted_at IS NULL;

ALTER TABLE document ADD COLUMN folder_id TEXT REFERENCES document_folder(id);
CREATE INDEX document_folder_idx ON document(folder_id) WHERE deleted_at IS NULL;
