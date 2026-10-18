-- Contagens de atividades por cartão (quadro, indicador, campos do cartão):
-- sem este índice o SQLite usava activity_end/activity_due (só "done") e
-- percorria todas as atividades pendentes para cada cartão.
CREATE INDEX activity_deal_done ON activity(deal_id, done, due_at, end_at) WHERE deleted_at IS NULL;
DROP INDEX activity_deal;
