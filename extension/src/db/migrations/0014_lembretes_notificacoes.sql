-- Lembretes múltiplos por atividade (antecedência + canais: Chrome, e-mail,
-- WhatsApp) e o registro das entregas (o que já foi enviado em cada canal,
-- tentativas e erros). O lembrete único de antes vira um lembrete "Chrome".
CREATE TABLE activity_reminder (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  activity_id     TEXT NOT NULL REFERENCES activity(id),
  minutes_before  INTEGER NOT NULL,
  channels        TEXT NOT NULL,          -- JSON: ["chrome","email","whatsapp"]
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT,
  deleted_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX activity_reminder_activity ON activity_reminder(activity_id) WHERE deleted_at IS NULL;

INSERT INTO activity_reminder (id, workspace_id, activity_id, minutes_before, channels, created_at, created_by, updated_at, updated_by, version)
SELECT lower(hex(randomblob(16))), workspace_id, id, reminder_min, '["chrome"]', created_at, created_by, updated_at, updated_by, 1
FROM activity WHERE reminder_min IS NOT NULL AND deleted_at IS NULL;

-- Entregas (operacional, deste computador): uma linha por aviso e canal.
-- key = "reminder:<id>:<início>", "digest:<usuário>:<dia>", "overdue:<id>:<desde>", "missed:<usuário>:<momento>".
CREATE TABLE notification_delivery (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL,
  channel         TEXT NOT NULL,          -- chrome | email | whatsapp
  user_id         TEXT,
  activity_id     TEXT,
  kind            TEXT NOT NULL,          -- reminder | digest | overdue | missed
  status          TEXT NOT NULL,          -- sent | failed | skipped
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error      TEXT,
  title           TEXT,
  sent_at         TEXT,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX notification_delivery_key ON notification_delivery(key, channel);
CREATE INDEX notification_delivery_activity ON notification_delivery(activity_id);
