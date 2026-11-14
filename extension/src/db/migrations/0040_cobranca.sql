-- Cobranças do cartão (link de pagamento do checkout da InfinitePay).
CREATE TABLE payment_charge (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  card_id         TEXT NOT NULL REFERENCES deal(id),
  provider        TEXT NOT NULL DEFAULT 'infinitepay',
  handle          TEXT NOT NULL,
  order_nsu       TEXT NOT NULL,
  url             TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL,
  description     TEXT NOT NULL,
  items_json      TEXT NOT NULL,
  due_date        TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'canceled')),
  paid_at         TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX payment_charge_card ON payment_charge(card_id, created_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX payment_charge_nsu ON payment_charge(order_nsu);
