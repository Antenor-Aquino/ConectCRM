-- Tickets de ativação abertos no Chatwoot a partir do cartão (aviso de repetição e histórico).
CREATE TABLE chatwoot_ticket (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspace(id),
  card_id          TEXT NOT NULL REFERENCES deal(id),
  conversation_id  INTEGER NOT NULL,
  link             TEXT NOT NULL,
  contact_email    TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT NOT NULL,
  updated_by       TEXT,
  deleted_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX chatwoot_ticket_card ON chatwoot_ticket(card_id, created_at) WHERE deleted_at IS NULL;
