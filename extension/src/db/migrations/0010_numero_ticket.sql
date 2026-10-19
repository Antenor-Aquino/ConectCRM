-- Número sequencial do ticket (cartões de funil Operacional), mostrado como
-- "Ticket: 123" e usado na busca. Os tickets existentes são numerados pela
-- ordem de criação (incluídos os excluídos, para os números não se repetirem).
ALTER TABLE deal ADD COLUMN ticket_number INTEGER;
UPDATE deal SET ticket_number = (
  SELECT COUNT(*) FROM deal d2
  WHERE d2.kind = 'ticket' AND (d2.created_at < deal.created_at OR (d2.created_at = deal.created_at AND d2.id <= deal.id))
) WHERE kind = 'ticket';
CREATE UNIQUE INDEX deal_ticket_number ON deal(ticket_number) WHERE ticket_number IS NOT NULL;
