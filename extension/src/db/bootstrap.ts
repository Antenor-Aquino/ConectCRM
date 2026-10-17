// Dados mínimos de uma instalação nova: o workspace (na v1 existe um só) e
// os tipos de tarefa padrão (spec 02) e de documento (spec 08). Idempotente.
import { newId, nowIso } from "../lib/ids";
import { ensureDocumentTypes } from "./documents";
import { insertRow, type DbContext } from "./repo";
import { one, run, withTransaction, type DatabaseSync } from "./sql";

export const DEFAULT_ACTIVITY_TYPES: { name: string; icon: string; isMeeting?: boolean }[] = [
  { name: "Ligar", icon: "phone" },
  { name: "Reunião", icon: "users", isMeeting: true },
  { name: "Agendamento", icon: "calendar-check", isMeeting: true },
  { name: "Tarefa", icon: "timer" },
  { name: "Deadline", icon: "flag" },
  { name: "Almoço", icon: "utensils" },
  { name: "E-mail", icon: "mail" },
];

/** Garante o workspace e os dados iniciais; devolve o id do workspace. */
export function bootstrap(db: DatabaseSync): string {
  return withTransaction(db, () => {
    const existing = one<{ id: string }>(db, "SELECT id FROM workspace ORDER BY created_at LIMIT 1");
    if (existing) {
      // Bases anteriores ao GED ganham os tipos de documento padrão.
      ensureDocumentTypes(db, { workspaceId: existing.id, userId: null });
      return existing.id;
    }

    const workspaceId = newId();
    const at = nowIso();
    run(db, "INSERT INTO workspace (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", workspaceId, "Minha empresa", at, at);

    const ctx: DbContext = { workspaceId, userId: null };
    DEFAULT_ACTIVITY_TYPES.forEach((t, i) => {
      insertRow(db, ctx, "activity_type", { name: t.name, icon: t.icon, is_meeting: t.isMeeting ? 1 : 0, position: i });
    });
    ensureDocumentTypes(db, ctx);
    return workspaceId;
  });
}
