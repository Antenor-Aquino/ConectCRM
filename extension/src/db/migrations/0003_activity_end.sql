-- Tarefas com início (due_at, nome histórico da coluna) e finalização
-- opcional (end_at). Atrasada passa a ser só quando a finalização venceu.
ALTER TABLE activity ADD COLUMN end_at TEXT;
-- Tarefas antigas: a data só vira finalização quando foi escolhida por alguém
-- (diferente do momento do cadastro); "agora" deixado no padrão não é prazo.
UPDATE activity SET end_at = due_at
 WHERE abs(julianday(due_at) - julianday(created_at)) * 1440 > 1;
CREATE INDEX activity_end ON activity(done, end_at) WHERE deleted_at IS NULL;
