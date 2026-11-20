-- Ticket do Chatwoot cancelado pelo cartão (resolvido no Chatwoot com observação).
ALTER TABLE chatwoot_ticket ADD COLUMN canceled_at TEXT;
ALTER TABLE chatwoot_ticket ADD COLUMN cancel_note TEXT;
