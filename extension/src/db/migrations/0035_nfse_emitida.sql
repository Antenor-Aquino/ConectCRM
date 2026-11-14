-- NFS-e (spec 19, fase 3): nota emitida pelo Emissor Nacional — número, chave
-- de acesso e ambiente ficam no rascunho do cartão.
ALTER TABLE nfse_draft ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued'));
ALTER TABLE nfse_draft ADD COLUMN access_key TEXT;
ALTER TABLE nfse_draft ADD COLUMN nfse_number TEXT;
ALTER TABLE nfse_draft ADD COLUMN environment TEXT;
ALTER TABLE nfse_draft ADD COLUMN issued_at TEXT;
