-- Integração com a Gestão Financeira (spec 13, Fase 2).
-- CPF (opcional) do contato: vai como documento do cliente/fornecedor quando
-- o lançamento é para uma pessoa física.
ALTER TABLE person ADD COLUMN cpf TEXT;  -- só dígitos
CREATE UNIQUE INDEX person_cpf ON person(workspace_id, cpf) WHERE cpf IS NOT NULL AND deleted_at IS NULL;

-- Cópia local dos lançamentos que a Gestão Financeira tem para cada cartão
-- (o dinheiro mora lá): mostra a aba Financeiro quando a outra extensão não
-- responde e alimenta os relatórios. Substituída inteira a cada leitura;
-- fora do change_log (não é dado do CRM).
CREATE TABLE finance_entry (
  id                TEXT PRIMARY KEY,      -- id do lançamento na Gestão Financeira
  workspace_id      TEXT NOT NULL REFERENCES workspace(id),
  deal_id           TEXT NOT NULL,
  code              TEXT,
  type              TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  status            TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
  description       TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  competence_date   TEXT NOT NULL,
  due_date          TEXT,
  payment_date      TEXT,
  category          TEXT,
  subcategory       TEXT,
  cost_center       TEXT,
  cost_subcenter    TEXT,
  counterparty      TEXT,
  wallet            TEXT,
  account           TEXT,
  credit_card       TEXT,
  installment_number INTEGER,
  installment_total  INTEGER
);
CREATE INDEX finance_entry_deal ON finance_entry(deal_id);

-- Quando cada cartão foi lido da Gestão Financeira pela última vez (e de qual ambiente).
CREATE TABLE finance_sync (
  deal_id      TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  env          TEXT NOT NULL,
  synced_at    TEXT NOT NULL
);
