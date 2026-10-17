-- Campos exibidos nos cartões do quadro, por funil (JSON com a lista ordenada
-- de chaves; NULL = padrão do tipo de funil). Ver lib/cardFields.ts.
ALTER TABLE pipeline ADD COLUMN card_fields TEXT;
