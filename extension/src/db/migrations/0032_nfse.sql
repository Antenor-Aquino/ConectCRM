-- NFS-e Nacional, fase 1 (spec 19): empresas emissoras, funil → empresa e
-- códigos fiscais dos serviços.
CREATE TABLE nfse_issuer (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  cnpj          TEXT NOT NULL,
  legal_name    TEXT NOT NULL,
  municipal_reg TEXT,
  city_ibge     TEXT,
  access        TEXT NOT NULL DEFAULT 'a1' CHECK (access IN ('a1', 'a3', 'govbr')),
  simples       INTEGER NOT NULL DEFAULT 3 CHECK (simples IN (1, 2, 3)),
  special_regime INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX nfse_issuer_cnpj ON nfse_issuer(cnpj) WHERE deleted_at IS NULL;

CREATE TABLE nfse_pipeline_issuer (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  pipeline_id   TEXT NOT NULL REFERENCES pipeline(id),
  issuer_id     TEXT NOT NULL REFERENCES nfse_issuer(id),
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX nfse_pipeline_issuer_pipeline ON nfse_pipeline_issuer(pipeline_id) WHERE deleted_at IS NULL;

ALTER TABLE product ADD COLUMN nfse_trib_nac TEXT;
ALTER TABLE product ADD COLUMN nfse_nbs TEXT;
