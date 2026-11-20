-- Baixa/exclusão da receita na Gestão Financeira com novas tentativas: a
-- cobrança do Inter pode ser paga antes de a receita ser salva lá (ou com a GF
-- fechada). gf_sync = 'paid' | 'canceled' enquanto falta levar a mudança à GF.
ALTER TABLE payment_charge ADD COLUMN gf_sync TEXT;
ALTER TABLE payment_charge ADD COLUMN gf_sync_since TEXT;
ALTER TABLE payment_charge ADD COLUMN gf_sync_error TEXT;
-- Boletos já pagos/cancelados: confere de novo (baixa e exclusão não repetem o que já foi feito).
UPDATE payment_charge SET gf_sync = status, gf_sync_since = updated_at
  WHERE provider = 'inter' AND status IN ('paid', 'canceled') AND deleted_at IS NULL;
