-- Envio de documento pelo WhatsApp com revisão (spec 08): ao preparar, o envio
-- fica pendente (com uma atividade pendente no cartão) e só vira concluído
-- quando a mensagem sai de fato pelo WhatsApp Web (ou o usuário confirma o
-- envio manual). Sem chave estrangeira na atividade/documento: a lixeira
-- cuida deles e o envio some junto (as consultas cruzam com a atividade).
CREATE TABLE whatsapp_send (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  activity_id     TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  context_type    TEXT NOT NULL,          -- tela de onde foi preparado: deal | person | organization | activity
  context_id      TEXT NOT NULL,
  recipient_kind  TEXT NOT NULL,          -- person | organization
  recipient_id    TEXT NOT NULL,
  recipient_name  TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  sender_id       TEXT,                   -- número de origem (Configurações → WhatsApp, guardado neste computador)
  from_label      TEXT,
  caption         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX whatsapp_send_context ON whatsapp_send(context_type, context_id, status);
CREATE INDEX whatsapp_send_activity ON whatsapp_send(activity_id);
