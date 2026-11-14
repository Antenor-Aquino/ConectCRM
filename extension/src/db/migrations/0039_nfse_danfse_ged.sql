-- NFS-e: DANFSe (PDF) guardado no GED, ligado ao cartão. Guarda qual documento
-- é o DANFSe da nota e se a versão salva já mostra "CANCELADA".
ALTER TABLE nfse_draft ADD COLUMN danfse_doc_id TEXT;
ALTER TABLE nfse_draft ADD COLUMN danfse_canceled INTEGER NOT NULL DEFAULT 0;
