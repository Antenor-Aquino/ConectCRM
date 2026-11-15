-- Lembrete do contato por WhatsApp com anexos: documentos do GED que vão junto.
-- NULL = só texto; "all" = todos os documentos da atividade na hora do envio;
-- JSON ["id", …] = os documentos escolhidos.
ALTER TABLE activity_contact_message ADD COLUMN attachments TEXT;
