-- foreign_keys: off
-- Status "Pendente" do cartão (todos os tipos de funil): aguardando a avaliação
-- do usuário para o desfecho final. O SQLite não altera CHECK, então a tabela
-- deal é refeita (procedimento padrão, como na 0004): nova tabela com as
-- mesmas colunas, copia, apaga a antiga, renomeia e recria os índices.
CREATE TABLE deal_new (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspace(id),
  -- Espelha pipeline.type: comercial → 'deal', operacional → 'ticket', projeto → 'project'.
  kind              TEXT NOT NULL CHECK (kind IN ('deal', 'ticket', 'project')),
  pipeline_id       TEXT NOT NULL REFERENCES pipeline(id),
  stage_id          TEXT NOT NULL REFERENCES stage(id),
  position          REAL NOT NULL DEFAULT 0,
  title             TEXT NOT NULL,
  description       TEXT,
  value_cents       INTEGER NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'BRL',
  value_from_items  INTEGER NOT NULL DEFAULT 0,
  sla_at            TEXT,
  start_at          TEXT,
  due_at            TEXT,
  expected_close_at TEXT,
  person_id         TEXT REFERENCES person(id),
  organization_id   TEXT REFERENCES organization(id),
  owner_id          TEXT REFERENCES app_user(id),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'won', 'lost')),
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
  version           INTEGER NOT NULL DEFAULT 1,
  ticket_number     INTEGER,
  archived_at       TEXT,
  finance_skip      INTEGER NOT NULL DEFAULT 0
);
INSERT INTO deal_new (id, workspace_id, kind, pipeline_id, stage_id, position, title, description, value_cents, currency, value_from_items,
  sla_at, start_at, due_at, expected_close_at, person_id, organization_id, owner_id, status, loss_reason_id, loss_note, closed_at,
  stage_entered_at, origin, created_at, created_by, updated_at, updated_by, deleted_at, version, ticket_number, archived_at, finance_skip)
SELECT id, workspace_id, kind, pipeline_id, stage_id, position, title, description, value_cents, currency, value_from_items,
  sla_at, start_at, due_at, expected_close_at, person_id, organization_id, owner_id, status, loss_reason_id, loss_note, closed_at,
  stage_entered_at, origin, created_at, created_by, updated_at, updated_by, deleted_at, version, ticket_number, archived_at, finance_skip
FROM deal;
DROP TABLE deal;
ALTER TABLE deal_new RENAME TO deal;
CREATE INDEX deal_board ON deal(pipeline_id, stage_id, position) WHERE deleted_at IS NULL;
CREATE INDEX deal_person ON deal(person_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_organization ON deal(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_stage_position ON deal(stage_id, position) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX deal_ticket_number ON deal(ticket_number) WHERE ticket_number IS NOT NULL;
