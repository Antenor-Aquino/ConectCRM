-- NFS-e pela API (spec 20, B1): dados fiscais da empresa para montar a DPS e
-- número da DPS reservado no rascunho (reenviar a mesma nota não pula número).
ALTER TABLE nfse_issuer ADD COLUMN simples_rate REAL;
ALTER TABLE nfse_issuer ADD COLUMN simples_regime INTEGER NOT NULL DEFAULT 1 CHECK (simples_regime IN (1, 2, 3));
ALTER TABLE nfse_issuer ADD COLUMN iss_rate REAL;
ALTER TABLE nfse_issuer ADD COLUMN dps_series TEXT NOT NULL DEFAULT '1';
ALTER TABLE nfse_issuer ADD COLUMN dps_next INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nfse_issuer ADD COLUMN cert_thumbprint TEXT;
ALTER TABLE nfse_draft ADD COLUMN dps_series TEXT;
ALTER TABLE nfse_draft ADD COLUMN dps_number INTEGER;
