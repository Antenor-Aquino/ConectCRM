-- To Do (spec 15): lista pessoal de afazeres, separada das Atividades do CRM.
-- Cada usuário vê só as próprias listas e tarefas (owner_id).

CREATE TABLE todo_list (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  owner_id      TEXT NOT NULL REFERENCES app_user(id),
  name          TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT 'blue',
  position      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX todo_list_owner ON todo_list(owner_id) WHERE deleted_at IS NULL;

-- list_id NULL = "Tarefas" (caixa de entrada).
CREATE TABLE todo_task (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  owner_id      TEXT NOT NULL REFERENCES app_user(id),
  list_id       TEXT REFERENCES todo_list(id),
  title         TEXT NOT NULL,
  notes         TEXT,
  important     INTEGER NOT NULL DEFAULT 0,
  due_date      TEXT,                     -- AAAA-MM-DD (vencimento)
  my_day        TEXT,                     -- AAAA-MM-DD em que foi posta em "Meu Dia" (fase 2)
  done          INTEGER NOT NULL DEFAULT 0,
  done_at       TEXT,
  position      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX todo_task_owner ON todo_task(owner_id, done) WHERE deleted_at IS NULL;
CREATE INDEX todo_task_list ON todo_task(list_id) WHERE deleted_at IS NULL;

-- Etapas (subtarefas com check).
CREATE TABLE todo_step (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  task_id       TEXT NOT NULL REFERENCES todo_task(id),
  title         TEXT NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  position      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX todo_step_task ON todo_step(task_id) WHERE deleted_at IS NULL;
