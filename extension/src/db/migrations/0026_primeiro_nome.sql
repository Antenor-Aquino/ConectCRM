-- Lembrete para o contato (0.2.77): {nome} passa a ser o nome completo e
-- {primeiro_nome} o primeiro nome. Os lembretes ainda não enviados que
-- começam pela saudação do modelo padrão ("Olá, {nome}! 👋") continuam
-- cumprimentando pelo primeiro nome. Modelos escritos pelo usuário mudam de
-- propósito: {nome} vira o nome completo.
UPDATE activity_contact_message
   SET template = 'Olá, {primeiro_nome}! 👋' || substr(template, length('Olá, {nome}! 👋') + 1)
 WHERE status = 'pending' AND deleted_at IS NULL AND substr(template, 1, length('Olá, {nome}! 👋')) = 'Olá, {nome}! 👋';

-- Séries: o modelo do lembrete fica dentro do JSON da atividade-modelo.
UPDATE activity_series
   SET template = replace(template, '"template":"Olá, {nome}! 👋', '"template":"Olá, {primeiro_nome}! 👋')
 WHERE instr(template, '"template":"Olá, {nome}! 👋') > 0;
