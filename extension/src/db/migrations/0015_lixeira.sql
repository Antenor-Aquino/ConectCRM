-- Lixeira (spec 11): cada exclusão vira um item, com as alterações feitas
-- naquele momento (o registro e o que foi junto: atividades e notas do
-- cartão, vínculos...), para restaurar tudo de uma vez. Passado o prazo
-- (configuração "trash.retention_days", padrão 30 dias), o item é excluído
-- definitivamente.
CREATE TABLE trash_item (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspace(id),
  entity        TEXT NOT NULL,          -- tabela do registro principal
  record_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  detail        TEXT,
  changes       TEXT NOT NULL,          -- JSON [{ table, row_id, op, changes }] na ordem em que aconteceram
  deleted_at    TEXT NOT NULL,
  deleted_by    TEXT
);
CREATE INDEX trash_item_deleted ON trash_item(deleted_at);
CREATE INDEX trash_item_record ON trash_item(record_id);
