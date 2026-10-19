-- Categorias de campos personalizados (ex.: "Dados profissionais" em
-- contatos): agrupam os campos nos formulários. Campo sem categoria fica no
-- grupo geral.
CREATE TABLE custom_field_group (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity        TEXT NOT NULL,
  name          TEXT NOT NULL,
  position      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX custom_field_group_entity ON custom_field_group(entity) WHERE deleted_at IS NULL;
ALTER TABLE custom_field ADD COLUMN group_id TEXT REFERENCES custom_field_group(id);
