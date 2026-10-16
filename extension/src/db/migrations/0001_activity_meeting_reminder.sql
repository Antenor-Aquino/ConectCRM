-- Fase 7: lembrete enviado (para não notificar duas vezes), link da reunião
-- (Meet/Teams) e convidados (JSON de e-mails) das tarefas.
ALTER TABLE activity ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE activity ADD COLUMN meeting_url TEXT;
ALTER TABLE activity ADD COLUMN guests TEXT;
