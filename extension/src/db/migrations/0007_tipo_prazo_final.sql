-- Tipo de tarefa padrão "Deadline" passa a se chamar "Prazo final" (sistema
-- todo em português). Só renomeia se o nome ainda for o original.
UPDATE activity_type SET name = 'Prazo final', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE name = 'Deadline' AND deleted_at IS NULL;
