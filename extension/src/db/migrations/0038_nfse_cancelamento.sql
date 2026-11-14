-- NFS-e (spec 20, B4): cancelamento da nota emitida. Pela API o pedido de
-- evento (e101101) e a resposta da Sefin ficam guardados; nota emitida pelo
-- portal pode ser registrada como cancelada lá (sem XML do evento).
ALTER TABLE nfse_draft ADD COLUMN canceled_at TEXT;
ALTER TABLE nfse_draft ADD COLUMN cancel_code INTEGER;
ALTER TABLE nfse_draft ADD COLUMN cancel_reason TEXT;
ALTER TABLE nfse_draft ADD COLUMN cancel_event_xml TEXT;
