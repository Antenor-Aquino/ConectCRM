-- Cobrança pelo Banco Inter (boleto + Pix, API Cobrança v3), ao lado da InfinitePay.
-- provider_ref = codigoSolicitacao do Inter; provider_env = sandbox | producao;
-- provider_status = situação do Inter (A_RECEBER, RECEBIDO, ATRASADO…);
-- barcode = linha digitável; pix_code = Pix copia e cola; pdf_doc_id = boleto no GED.
ALTER TABLE payment_charge ADD COLUMN provider_ref TEXT;
ALTER TABLE payment_charge ADD COLUMN provider_env TEXT;
ALTER TABLE payment_charge ADD COLUMN provider_status TEXT;
ALTER TABLE payment_charge ADD COLUMN barcode TEXT;
ALTER TABLE payment_charge ADD COLUMN pix_code TEXT;
ALTER TABLE payment_charge ADD COLUMN pdf_doc_id TEXT;
ALTER TABLE payment_charge ADD COLUMN received_cents INTEGER;
ALTER TABLE payment_charge ADD COLUMN checked_at TEXT;
CREATE INDEX payment_charge_open_inter ON payment_charge(provider, status) WHERE deleted_at IS NULL;
