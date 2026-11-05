-- To Do fase 4 (spec 15): grupos de listas (como no Microsoft To Do).
CREATE TABLE todo_group (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  owner_id      TEXT NOT NULL REFERENCES app_user(id),
  name          TEXT NOT NULL,
  position      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX todo_group_owner ON todo_group(owner_id) WHERE deleted_at IS NULL;
-- Lista fora de grupo: group_id nulo.
ALTER TABLE todo_list ADD COLUMN group_id TEXT REFERENCES todo_group(id);
