-- Origem de um registro criado por automação (spec 12): hoje, o Copiloto
-- criando cartão, contato e organização a partir de um documento. O histórico
-- do cartão mostra esta linha resumida ("Criado pelo Copiloto a partir do
-- documento X") no lugar das várias alterações feitas no mesmo instante.
CREATE TABLE record_origin (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity_type   TEXT NOT NULL,          -- deal | person | organization
  local_id      TEXT NOT NULL,
  source        TEXT NOT NULL,          -- 'copilot-document'
  document_id   TEXT,                   -- documento do GED de onde veio
  summary       TEXT NOT NULL,          -- JSON: { file, docType, provider, created: {...}, linked: {...}, tags: [...] }
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX record_origin_local ON record_origin(local_id);
