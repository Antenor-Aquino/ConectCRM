-- Contatos e organizações que já estão em "Clientes e fornecedores" da Gestão
-- Financeira (spec 13, paridade de cadastros): entram ao serem usados num
-- lançamento ou enviados pelo botão; `pending` = alterado no CRM e ainda não
-- enviado (vai na hora, no modo direto, ou no próximo pacote). Fora do change_log.
CREATE TABLE finance_contact (
  crm_ref       TEXT PRIMARY KEY,         -- person:<id> | organization:<id>
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  pending       INTEGER NOT NULL DEFAULT 1,
  linked_at     TEXT NOT NULL,
  sent_at       TEXT
);
