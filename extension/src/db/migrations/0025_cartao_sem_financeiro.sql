-- "Não registrar no financeiro" (spec 13): ao ganhar/concluir, o usuário pode
-- dizer que o valor do cartão não vai para a Gestão Financeira (ex.: vai
-- receber só parte e lança à parte). O cartão sai dos avisos de receita a lançar.
ALTER TABLE deal ADD COLUMN finance_skip INTEGER NOT NULL DEFAULT 0;
