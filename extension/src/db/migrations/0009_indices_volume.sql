-- Índices para bases grandes (teste com 20 mil organizações e 50 mil cartões):
-- posição do cartão no topo/fim da etapa (criar e mover cartão),
-- contatos por organização (lista de organizações) e ordem por nome.
CREATE INDEX deal_stage_position ON deal(stage_id, position) WHERE deleted_at IS NULL;
CREATE INDEX person_organization_org ON person_organization(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX organization_name ON organization(name COLLATE NOCASE) WHERE deleted_at IS NULL;
