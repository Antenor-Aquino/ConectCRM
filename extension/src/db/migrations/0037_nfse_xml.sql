-- NFS-e pela API (spec 20, B3): XML da NFS-e devolvido pela Sefin Nacional,
-- guardado no rascunho do cartão (download e, na B4, o PDF/DANFSe).
ALTER TABLE nfse_draft ADD COLUMN nfse_xml TEXT;
