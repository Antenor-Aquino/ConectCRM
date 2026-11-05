-- To Do fase 5 (spec 15): tarefa ligada ao CRM — negócio/ticket, contato e
-- a atividade criada a partir dela (ou da qual ela veio).
ALTER TABLE todo_task ADD COLUMN deal_id TEXT REFERENCES deal(id);
ALTER TABLE todo_task ADD COLUMN person_id TEXT REFERENCES person(id);
ALTER TABLE todo_task ADD COLUMN activity_id TEXT REFERENCES activity(id);
CREATE INDEX todo_task_activity ON todo_task(activity_id) WHERE deleted_at IS NULL;
