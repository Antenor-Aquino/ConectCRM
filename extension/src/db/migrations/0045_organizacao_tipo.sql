-- Tipo da organização no cadastro: quem paga (pagador, ex.: Caixa Escolar),
-- mantenedora, unidade/escola ou outra. Sugere o papel ao vincular a um cartão.
-- Paridade: vai na ficha para a Gestão Financeira (ContactCard.orgType).
ALTER TABLE organization ADD COLUMN org_type TEXT CHECK (org_type IN ('pagador', 'mantenedora', 'cliente', 'outra'));
