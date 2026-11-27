-- Ficha do cartão (visão completa) por funil: ordem e visibilidade dos campos
-- (JSON [{key, hidden?}], lib/detailLayout.ts); null = padrão.
ALTER TABLE pipeline ADD COLUMN detail_layout TEXT;
