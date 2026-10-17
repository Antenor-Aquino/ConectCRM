-- Nota com referência aos documentos do GED de onde veio (ex.: transcrição
-- de um áudio ou recorte): lista JSON de ids de documento.
ALTER TABLE note ADD COLUMN document_ids TEXT;
