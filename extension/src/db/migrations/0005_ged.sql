-- foreign_keys: off
-- GED (spec 08): documentos com nome, classificação, validade, versões,
-- vínculos múltiplos (contato, organização, cartão, tarefa) e trilha de
-- auditoria. O conteúdo dos arquivos fica fora do SQLite (file_blob guarda
-- só onde está: navegador ou pasta escolhida), identificado pelo SHA-256.

CREATE TABLE document_type (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT 'slate',
  valid_days    INTEGER,               -- validade sugerida (ex.: comprovante = 90)
  active        INTEGER NOT NULL DEFAULT 1,
  position      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX document_type_name ON document_type(workspace_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

-- location: 'browser' (IndexedDB), 'folder' (pasta do computador, em path)
-- ou 'legacy' (ainda em attachment.data, aguardando a mudança em open).
CREATE TABLE file_blob (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  sha256        TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  location      TEXT NOT NULL CHECK (location IN ('browser', 'folder', 'legacy')),
  path          TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX file_blob_sha ON file_blob(workspace_id, sha256) WHERE deleted_at IS NULL;

-- deleted_at = na lixeira; purged_at = excluído de vez (arquivo apagado).
CREATE TABLE document (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspace(id),
  name               TEXT NOT NULL,
  type_id            TEXT REFERENCES document_type(id),   -- NULL = não classificado
  description        TEXT,
  doc_date           TEXT,                                -- AAAA-MM-DD
  valid_until        TEXT,                                -- AAAA-MM-DD
  restricted         INTEGER NOT NULL DEFAULT 0,
  current_version_id TEXT,
  purged_at          TEXT,
  created_at         TEXT NOT NULL,
  created_by         TEXT,
  updated_at         TEXT NOT NULL,
  updated_by         TEXT,
  deleted_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX document_valid ON document(valid_until) WHERE deleted_at IS NULL;

CREATE TABLE document_version (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  document_id   TEXT NOT NULL REFERENCES document(id),
  number        INTEGER NOT NULL,
  blob_id       TEXT NOT NULL REFERENCES file_blob(id),
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  -- Texto extraído (PDF), já sem acento e minúsculo, para a busca.
  text_content  TEXT,
  text_status   TEXT NOT NULL DEFAULT 'none' CHECK (text_status IN ('none', 'pending', 'done')),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX document_version_doc ON document_version(document_id);

-- auto = 1: vínculo criado pelo contexto da tela (ex.: o contato do cartão).
CREATE TABLE document_link (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  document_id   TEXT NOT NULL REFERENCES document(id),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('person', 'organization', 'deal', 'activity')),
  entity_id     TEXT NOT NULL,
  auto          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX document_link_unique ON document_link(document_id, entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX document_link_entity ON document_link(entity_type, entity_id) WHERE deleted_at IS NULL;

-- Acessos que não alteram dados (visualizar, baixar), para a auditoria.
CREATE TABLE document_event (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  document_id   TEXT NOT NULL REFERENCES document(id),
  action        TEXT NOT NULL,
  detail        TEXT,
  user_id       TEXT,
  at            TEXT NOT NULL
);
CREATE INDEX document_event_doc ON document_event(document_id, at);

-- Palavras-chave = tags da entidade 'document' (refaz o CHECK, como na 0004).
CREATE TABLE tag_new (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity        TEXT NOT NULL CHECK (entity IN ('person', 'organization', 'deal', 'ticket', 'project', 'activity', 'document')),
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

-- Campo personalizado do tipo 'document' (aponta para um documento do GED).
CREATE TABLE custom_field_new (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  entity          TEXT NOT NULL CHECK (entity IN ('person', 'organization', 'deal', 'ticket', 'project', 'activity', 'product')),
  name            TEXT NOT NULL,
  description     TEXT,
  field_type      TEXT NOT NULL CHECK (field_type IN (
                    'text', 'textarea', 'number', 'money', 'date', 'datetime', 'boolean',
                    'select', 'multiselect', 'phone', 'email', 'url', 'user', 'person', 'organization', 'document')),
  placeholder_key TEXT NOT NULL,
  always_show     INTEGER NOT NULL DEFAULT 0,
  hidden          INTEGER NOT NULL DEFAULT 0,
  required        INTEGER NOT NULL DEFAULT 0,
  position        REAL NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
INSERT INTO custom_field_new SELECT id, workspace_id, entity, name, description, field_type, placeholder_key, always_show, hidden, required, position, active,
  created_at, created_by, updated_at, updated_by, deleted_at, version FROM custom_field;
DROP TABLE custom_field;
ALTER TABLE custom_field_new RENAME TO custom_field;
CREATE UNIQUE INDEX custom_field_key ON custom_field(workspace_id, placeholder_key) WHERE deleted_at IS NULL;

-- Anexos existentes de cartão e tarefa viram documentos "não classificados",
-- com os vínculos que a regra de hoje criaria. O conteúdo sai de
-- attachment.data depois (moveLegacyFiles, que calcula o SHA-256).
INSERT INTO file_blob (id, workspace_id, sha256, mime, size_bytes, location, created_at, created_by, updated_at)
  SELECT id, workspace_id, 'legacy:' || id, mime, size_bytes, 'legacy', created_at, created_by, updated_at
  FROM attachment WHERE deleted_at IS NULL AND entity_type IN ('deal', 'activity');

INSERT INTO document (id, workspace_id, name, current_version_id, created_at, created_by, updated_at)
  SELECT 'd' || id, workspace_id,
    CASE WHEN instr(filename, '.') > 1
      THEN substr(filename, 1, length(filename) - length(replace(filename, rtrim(filename, replace(filename, '.', '')), '')) - 1)
      ELSE filename END,
    'v' || id, created_at, created_by, updated_at
  FROM attachment WHERE deleted_at IS NULL AND entity_type IN ('deal', 'activity');

INSERT INTO document_version (id, workspace_id, document_id, number, blob_id, filename, mime, size_bytes, text_status, created_at, created_by, updated_at)
  SELECT 'v' || id, workspace_id, 'd' || id, 1, id, filename, mime, size_bytes,
    CASE WHEN mime = 'application/pdf' THEN 'pending' ELSE 'none' END, created_at, created_by, updated_at
  FROM attachment WHERE deleted_at IS NULL AND entity_type IN ('deal', 'activity');

-- Vínculo original e os derivados (contato/organização do cartão; cartão,
-- contato e organização da tarefa).
CREATE TEMP TABLE legacy_link (document_id TEXT, entity_type TEXT, entity_id TEXT, auto INTEGER, workspace_id TEXT, created_at TEXT, created_by TEXT);
INSERT INTO legacy_link SELECT 'd' || a.id, a.entity_type, a.entity_id, 0, a.workspace_id, a.created_at, a.created_by
  FROM attachment a WHERE a.deleted_at IS NULL AND a.entity_type IN ('deal', 'activity');
INSERT INTO legacy_link SELECT 'd' || a.id, 'person', d.person_id, 1, a.workspace_id, a.created_at, a.created_by
  FROM attachment a JOIN deal d ON d.id = a.entity_id WHERE a.deleted_at IS NULL AND a.entity_type = 'deal' AND d.person_id IS NOT NULL;
INSERT INTO legacy_link SELECT 'd' || a.id, 'organization', d.organization_id, 1, a.workspace_id, a.created_at, a.created_by
  FROM attachment a JOIN deal d ON d.id = a.entity_id WHERE a.deleted_at IS NULL AND a.entity_type = 'deal' AND d.organization_id IS NOT NULL;
INSERT INTO legacy_link SELECT 'd' || a.id, 'deal', t.deal_id, 1, a.workspace_id, a.created_at, a.created_by
  FROM attachment a JOIN activity t ON t.id = a.entity_id WHERE a.deleted_at IS NULL AND a.entity_type = 'activity' AND t.deal_id IS NOT NULL;
INSERT INTO legacy_link SELECT 'd' || a.id, 'person', COALESCE(t.person_id, d.person_id), 1, a.workspace_id, a.created_at, a.created_by
  FROM attachment a JOIN activity t ON t.id = a.entity_id LEFT JOIN deal d ON d.id = t.deal_id
  WHERE a.deleted_at IS NULL AND a.entity_type = 'activity' AND COALESCE(t.person_id, d.person_id) IS NOT NULL;
INSERT INTO legacy_link SELECT 'd' || a.id, 'organization', COALESCE(t.organization_id, d.organization_id), 1, a.workspace_id, a.created_at, a.created_by
  FROM attachment a JOIN activity t ON t.id = a.entity_id LEFT JOIN deal d ON d.id = t.deal_id
  WHERE a.deleted_at IS NULL AND a.entity_type = 'activity' AND COALESCE(t.organization_id, d.organization_id) IS NOT NULL;
INSERT OR IGNORE INTO document_link (id, workspace_id, document_id, entity_type, entity_id, auto, created_at, created_by, updated_at)
  SELECT lower(hex(randomblob(16))), workspace_id, document_id, entity_type, entity_id, MIN(auto), created_at, created_by, created_at
  FROM legacy_link GROUP BY document_id, entity_type, entity_id;
DROP TABLE legacy_link;
