-- Várias organizações no cartão: além da principal (deal.organization_id), outras
-- com um papel — quem paga (pagador, ex.: Caixa Escolar), a mantenedora, outras
-- unidades/escolas da rede (cliente) ou outra relação.
CREATE TABLE deal_org_link (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  deal_id         TEXT NOT NULL REFERENCES deal(id),
  organization_id TEXT NOT NULL REFERENCES organization(id),
  role            TEXT NOT NULL DEFAULT 'outra' CHECK (role IN ('cliente', 'pagador', 'mantenedora', 'outra')),
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX deal_org_link_deal ON deal_org_link(deal_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_org_link_org ON deal_org_link(organization_id) WHERE deleted_at IS NULL;
