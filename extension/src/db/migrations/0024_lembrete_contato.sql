-- Lembrete para o contato por WhatsApp (spec 10): uma mensagem agendada por
-- atividade, enviada pela extensão (Z-API ou WhatsApp Web) X minutos antes do
-- início. Editável até sair; depois fica só para leitura.
-- status: pending | sent | failed (tentou e deu erro) | skipped (passou da hora
-- com o Chrome fechado) | canceled (atividade concluída/excluída antes).
CREATE TABLE activity_contact_message (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  activity_id     TEXT NOT NULL REFERENCES activity(id),
  person_id       TEXT NOT NULL REFERENCES person(id),
  minutes_before  INTEGER NOT NULL,
  template        TEXT NOT NULL,
  sender_id       TEXT,                  -- número de origem (Configurações → WhatsApp)
  status          TEXT NOT NULL DEFAULT 'pending',
  sent_at         TEXT,
  sent_text       TEXT,                  -- o texto que saiu de fato
  error           TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX activity_contact_message_one ON activity_contact_message(activity_id) WHERE deleted_at IS NULL;
CREATE INDEX activity_contact_message_pending ON activity_contact_message(status) WHERE deleted_at IS NULL;

-- Empresa do funil: assina as mensagens dos cartões dele ("Antenor · AEB Sistemas").
ALTER TABLE pipeline ADD COLUMN company_name TEXT;
