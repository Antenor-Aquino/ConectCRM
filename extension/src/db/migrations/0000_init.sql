-- ConectCRM — esquema inicial.
--
-- Preparação para sincronização futura (PLANEJAMENTO.md, seção 5.2): toda
-- tabela de dados tem id UUID gerado no cliente, workspace_id, autoria
-- (created_*/updated_*), exclusão lógica (deleted_at) e version. Toda
-- gravação passa por src/db/repo.ts, que também alimenta change_log.
--
-- Datas: TEXT ISO 8601. Dinheiro: INTEGER em centavos.
-- Unicidades consideram só registros não excluídos (índices parciais).

CREATE TABLE workspace (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Configurações chave/valor (JSON) por workspace.
CREATE TABLE setting (
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
);

-- ============ Usuários e equipes ============

CREATE TABLE app_user (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'gestor', 'vendedor')),
  color         TEXT,
  avatar_id     TEXT,
  pin_hash      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE team (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE team_member (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  team_id       TEXT NOT NULL REFERENCES team(id),
  user_id       TEXT NOT NULL REFERENCES app_user(id),
  is_leader     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX team_member_unique ON team_member(team_id, user_id) WHERE deleted_at IS NULL;

-- ============ Funis ============

CREATE TABLE pipeline (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,
  -- Tipo fixo após a criação (spec 01, P5).
  type          TEXT NOT NULL CHECK (type IN ('comercial', 'operacional', 'projeto')),
  icon          TEXT,
  color         TEXT,
  position      REAL NOT NULL DEFAULT 0,
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE stage (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  pipeline_id   TEXT NOT NULL REFERENCES pipeline(id),
  name          TEXT NOT NULL,
  color         TEXT,
  position      REAL NOT NULL DEFAULT 0,
  probability   INTEGER CHECK (probability BETWEEN 0 AND 100),
  stale_days    INTEGER,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX stage_pipeline ON stage(pipeline_id, position);

CREATE TABLE loss_reason (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

-- ============ Contatos e organizações ============

CREATE TABLE person (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspace(id),
  name              TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,              -- E.164 normalizado (+5511999998888)
  phone_country     TEXT,              -- ISO 3166 (BR)
  notes             TEXT,
  avatar_id         TEXT,
  owner_id          TEXT REFERENCES app_user(id),
  is_private        INTEGER NOT NULL DEFAULT 0,
  google_sync       INTEGER NOT NULL DEFAULT 0,
  google_contact_id TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX person_phone ON person(phone) WHERE deleted_at IS NULL;
CREATE INDEX person_email ON person(email) WHERE deleted_at IS NULL;

CREATE TABLE organization (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,         -- nome fantasia
  legal_name    TEXT,                  -- razão social
  cnpj          TEXT,                  -- só dígitos
  website       TEXT,
  segment       TEXT,
  owner_id      TEXT REFERENCES app_user(id),
  phone         TEXT,
  phone_country TEXT,
  email         TEXT,
  cep           TEXT,
  street        TEXT,
  number        TEXT,
  complement    TEXT,
  district      TEXT,
  city          TEXT,
  state         TEXT,
  country       TEXT,
  description   TEXT,
  logo_id       TEXT,
  cnpj_data     TEXT,                  -- JSON bruto da consulta à Receita
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX organization_cnpj ON organization(workspace_id, cnpj)
  WHERE cnpj IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE person_organization (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  person_id       TEXT NOT NULL REFERENCES person(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  is_primary      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX person_organization_unique ON person_organization(person_id, organization_id)
  WHERE deleted_at IS NULL;

-- ============ Cartões do Kanban (negócio / ticket / etapa de projeto) ============

CREATE TABLE deal (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspace(id),
  -- Espelha pipeline.type: comercial → 'deal', operacional → 'ticket', projeto → 'project'.
  kind              TEXT NOT NULL CHECK (kind IN ('deal', 'ticket', 'project')),
  pipeline_id       TEXT NOT NULL REFERENCES pipeline(id),
  stage_id          TEXT NOT NULL REFERENCES stage(id),
  position          REAL NOT NULL DEFAULT 0,   -- ordem dentro da coluna
  title             TEXT NOT NULL,
  description       TEXT,
  value_cents       INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'BRL',
  value_from_items  INTEGER NOT NULL DEFAULT 0, -- 1 = valor é a soma de deal_item
  sla_at            TEXT,                       -- ticket
  start_at          TEXT,                       -- projeto
  due_at            TEXT,                       -- projeto
  expected_close_at TEXT,                       -- negócio
  person_id         TEXT REFERENCES person(id),
  organization_id   TEXT REFERENCES organization(id),
  owner_id          TEXT REFERENCES app_user(id),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  loss_reason_id    TEXT REFERENCES loss_reason(id),
  loss_note         TEXT,
  closed_at         TEXT,
  stage_entered_at  TEXT NOT NULL,
  origin            TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX deal_board ON deal(pipeline_id, stage_id, position) WHERE deleted_at IS NULL;
CREATE INDEX deal_person ON deal(person_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_organization ON deal(organization_id) WHERE deleted_at IS NULL;

-- Histórico de etapas: base dos relatórios de conversão e tempo por etapa.
CREATE TABLE deal_stage_history (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  deal_id       TEXT NOT NULL REFERENCES deal(id),
  stage_id      TEXT NOT NULL REFERENCES stage(id),
  entered_at    TEXT NOT NULL,
  left_at       TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX deal_stage_history_deal ON deal_stage_history(deal_id, entered_at);

CREATE TABLE deal_participant (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  deal_id       TEXT NOT NULL REFERENCES deal(id),
  user_id       TEXT REFERENCES app_user(id),
  person_id     TEXT REFERENCES person(id),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  CHECK ((user_id IS NULL) <> (person_id IS NULL))
);

-- ============ Produtos e serviços ============

CREATE TABLE product_category (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE product (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  code          TEXT,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('produto', 'servico')),
  unit          TEXT,
  price_cents   INTEGER NOT NULL DEFAULT 0,
  cost_cents    INTEGER,
  recurrence    TEXT NOT NULL DEFAULT 'avulso' CHECK (recurrence IN ('avulso', 'mensal', 'trimestral', 'semestral', 'anual')),
  category_id   TEXT REFERENCES product_category(id),
  description   TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX product_code ON product(workspace_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE deal_item (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspace(id),
  deal_id          TEXT NOT NULL REFERENCES deal(id),
  product_id       TEXT REFERENCES product(id),
  description      TEXT NOT NULL,
  quantity         REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents   INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  recurrence       TEXT NOT NULL DEFAULT 'avulso',
  position         REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT,
  deleted_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX deal_item_deal ON deal_item(deal_id) WHERE deleted_at IS NULL;

-- ============ Tarefas ============

CREATE TABLE activity_type (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL,
  -- Reunião/Agendamento podem criar evento no Google Agenda/Outlook.
  is_meeting    INTEGER NOT NULL DEFAULT 0,
  position      REAL NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE activity (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspace(id),
  type_id           TEXT NOT NULL REFERENCES activity_type(id),
  title             TEXT NOT NULL,
  description       TEXT,
  due_at            TEXT NOT NULL,
  duration_min      INTEGER NOT NULL DEFAULT 5,
  reminder_min      INTEGER,
  done              INTEGER NOT NULL DEFAULT 0,
  done_at           TEXT,
  owner_id          TEXT REFERENCES app_user(id),
  -- "Vinculado a" é opcional (spec 02).
  deal_id           TEXT REFERENCES deal(id),
  person_id         TEXT REFERENCES person(id),
  organization_id   TEXT REFERENCES organization(id),
  external_provider TEXT CHECK (external_provider IN ('google', 'microsoft')),
  external_event_id TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_at        TEXT NOT NULL,
  updated_by        TEXT,
  deleted_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX activity_due ON activity(done, due_at) WHERE deleted_at IS NULL;
CREATE INDEX activity_deal ON activity(deal_id) WHERE deleted_at IS NULL;

-- ============ Notas, anexos, WhatsApp ============

-- entity_type: 'person' | 'organization' | 'deal' | 'activity'
CREATE TABLE note (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  body          TEXT NOT NULL,         -- HTML
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX note_entity ON note(entity_type, entity_id) WHERE deleted_at IS NULL;

CREATE TABLE attachment (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity_type   TEXT,
  entity_id     TEXT,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  data          BLOB NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX attachment_entity ON attachment(entity_type, entity_id) WHERE deleted_at IS NULL;

CREATE TABLE whatsapp_capture (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  person_id     TEXT REFERENCES person(id),
  deal_id       TEXT REFERENCES deal(id),
  chat_name     TEXT,
  chat_phone    TEXT,
  messages      TEXT NOT NULL,         -- JSON
  summary       TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

-- ============ Tags (separadas por entidade) ============

-- entity: 'person' | 'organization' | 'deal' | 'ticket' | 'project'
CREATE TABLE tag (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity        TEXT NOT NULL CHECK (entity IN ('person', 'organization', 'deal', 'ticket', 'project')),
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
CREATE UNIQUE INDEX tag_name ON tag(workspace_id, entity, name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE entity_tag (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  tag_id        TEXT NOT NULL REFERENCES tag(id),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX entity_tag_unique ON entity_tag(tag_id, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX entity_tag_entity ON entity_tag(entity_type, entity_id) WHERE deleted_at IS NULL;

-- ============ Campos personalizados ============

-- entity: 'person' | 'organization' | 'deal' | 'ticket' | 'project' | 'activity' | 'product'
CREATE TABLE custom_field (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  entity          TEXT NOT NULL CHECK (entity IN ('person', 'organization', 'deal', 'ticket', 'project', 'activity', 'product')),
  name            TEXT NOT NULL,
  description     TEXT,
  field_type      TEXT NOT NULL CHECK (field_type IN (
                    'text', 'textarea', 'number', 'money', 'date', 'datetime', 'boolean',
                    'select', 'multiselect', 'phone', 'email', 'url', 'user', 'person', 'organization')),
  placeholder_key TEXT NOT NULL,       -- chave reservada usada no chat: {{chave}}
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
CREATE UNIQUE INDEX custom_field_key ON custom_field(workspace_id, placeholder_key) WHERE deleted_at IS NULL;

CREATE TABLE custom_field_option (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  field_id      TEXT NOT NULL REFERENCES custom_field(id),
  label         TEXT NOT NULL,
  color         TEXT,
  position      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

-- Restringe o campo a funis específicos (sem linhas = vale para todos).
CREATE TABLE custom_field_pipeline (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  field_id      TEXT NOT NULL REFERENCES custom_field(id),
  pipeline_id   TEXT NOT NULL REFERENCES pipeline(id),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

-- Um valor por campo e registro. Listas múltiplas guardam JSON de ids de opção.
CREATE TABLE custom_field_value (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  field_id      TEXT NOT NULL REFERENCES custom_field(id),
  entity_id     TEXT NOT NULL,
  value         TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX custom_field_value_unique ON custom_field_value(field_id, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX custom_field_value_entity ON custom_field_value(entity_id) WHERE deleted_at IS NULL;

-- ============ Visões salvas ============

CREATE TABLE saved_filter (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  user_id       TEXT REFERENCES app_user(id),
  scope         TEXT NOT NULL,         -- ex.: 'board', 'persons', 'activities'
  name          TEXT NOT NULL,
  definition    TEXT NOT NULL,         -- JSON
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

-- ============ Registro de alterações ============

-- Alimenta a timeline/histórico e, no futuro, a fila de sincronização
-- (synced_at fica vazio enquanto não houver servidor).
CREATE TABLE change_log (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  table_name    TEXT NOT NULL,
  row_id        TEXT NOT NULL,
  op            TEXT NOT NULL CHECK (op IN ('insert', 'update', 'delete', 'restore')),
  changes       TEXT NOT NULL,         -- JSON { campo: [antigo, novo] }
  row_version   INTEGER NOT NULL,
  user_id       TEXT,
  at            TEXT NOT NULL,
  synced_at     TEXT
);
CREATE INDEX change_log_row ON change_log(table_name, row_id, at);
CREATE INDEX change_log_unsynced ON change_log(at) WHERE synced_at IS NULL;
