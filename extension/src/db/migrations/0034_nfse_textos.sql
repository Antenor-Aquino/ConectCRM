-- NFS-e (spec 19): textos personalizados de cada nota. Modelos por empresa
-- (discriminação e observação, com campos como {itens} e {pedido}) e o
-- rascunho salvo no cartão (revisado pelo usuário antes de emitir).
ALTER TABLE nfse_issuer ADD COLUMN description_template TEXT;
ALTER TABLE nfse_issuer ADD COLUMN notes_template TEXT;

CREATE TABLE nfse_draft (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  card_id       TEXT NOT NULL REFERENCES deal(id),
  issuer_id     TEXT REFERENCES nfse_issuer(id),
  taker_id      TEXT,
  description   TEXT,
  notes         TEXT,
  order_number  TEXT,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX nfse_draft_card ON nfse_draft(card_id) WHERE deleted_at IS NULL;
CREATE INDEX nfse_draft_taker ON nfse_draft(taker_id, updated_at) WHERE deleted_at IS NULL;
