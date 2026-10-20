-- Pedidos de lançamento no modo pacote (spec 13, Fase 4): feitos na aba
-- Financeiro do cartão quando a Gestão Financeira não está neste Chrome;
-- saem num arquivo (Exportar pacote) e voltam como lançados quando o arquivo
-- de retorno da Gestão Financeira é importado. Fora do change_log.
CREATE TABLE finance_request (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  deal_id       TEXT NOT NULL,
  payload       TEXT NOT NULL,            -- JSON do PackageRequest
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'exported', 'launched')),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  exported_at   TEXT,
  launched_at   TEXT,
  deleted_at    TEXT
);
CREATE INDEX finance_request_deal ON finance_request(deal_id);
