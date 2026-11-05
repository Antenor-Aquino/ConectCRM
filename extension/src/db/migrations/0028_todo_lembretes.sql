-- To Do fase 3 (spec 15): lembrete com data e hora e tarefas que se repetem.
ALTER TABLE todo_task ADD COLUMN remind_at TEXT;      -- ISO (UTC): quando avisar
ALTER TABLE todo_task ADD COLUMN reminded_at TEXT;    -- quando o aviso saiu (nulo = ainda não)
ALTER TABLE todo_task ADD COLUMN recurrence TEXT;     -- JSON {every, unit, weekdays?}; nulo = não repete
CREATE INDEX todo_task_remind ON todo_task(remind_at) WHERE deleted_at IS NULL AND done = 0 AND reminded_at IS NULL;
