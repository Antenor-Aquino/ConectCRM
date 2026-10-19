-- Cartão arquivado: sai do quadro e da lista (filtro "Arquivados" mostra),
-- mas continua nos relatórios, na busca e na ficha do contato.
ALTER TABLE deal ADD COLUMN archived_at TEXT;
CREATE INDEX deal_participant_deal ON deal_participant(deal_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_participant_person ON deal_participant(person_id) WHERE deleted_at IS NULL;
