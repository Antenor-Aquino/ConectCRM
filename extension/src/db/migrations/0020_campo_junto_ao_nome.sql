-- Campo personalizado exibido junto com o nome do registro ("Maria José -
-- Diretora", "AEB Sistemas - Saúde"). No máximo 2 por entidade (o código
-- confere ao salvar).
ALTER TABLE custom_field ADD COLUMN show_with_name INTEGER NOT NULL DEFAULT 0;
