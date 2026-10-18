-- Vínculo de um registro do CRM com o registro de origem numa integração
-- (Pipedrive e futuras): mostra "já importado", permite atualizar e abrir o
-- original. Um registro externo aponta para um registro local por vez.
CREATE TABLE external_ref (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspace(id),
  provider          TEXT NOT NULL,         -- 'pipedrive'
  entity_type       TEXT NOT NULL,         -- 'person' | 'organization' | 'deal'
  external_id       TEXT NOT NULL,
  local_id          TEXT NOT NULL,
  -- update_time do registro na origem na última importação/atualização.
  source_updated_at TEXT,
  imported_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX external_ref_source ON external_ref(provider, entity_type, external_id) WHERE deleted_at IS NULL;
CREATE INDEX external_ref_local ON external_ref(local_id) WHERE deleted_at IS NULL;
