// To Do (spec 15): lista pessoal de afazeres, separada das Atividades do CRM
// (benchmark: Microsoft To Do). Cada usuário vê só o que é dele (owner_id).
// Listas inteligentes: Importante, Planejado, Todas e Tarefas (sem lista).
import { nowIso } from "../lib/ids";
import { nextOccurrence, parseRecurrence, sameTimeOn, todayYmd, type Recurrence } from "../lib/todo";
import { optionalText, requireText, ValidationError } from "../lib/validate";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { moveToTrash, type TrashNotice } from "./trash";
import { many, one, run, withTransaction, type DatabaseSync, type SqlValue } from "./sql";

export type TodoSmart = "meudia" | "importante" | "planejado" | "todas" | "tarefas";
export type TodoView = { smart: TodoSmart } | { listId: string };

export const LIST_COLORS = ["blue", "green", "red", "orange", "purple", "pink", "slate"] as const;

export interface TodoList {
  id: string;
  name: string;
  color: string;
  position: number;
  pending: number;
}

export interface TodoStep {
  id: string;
  title: string;
  done: number;
  position: number;
}

export interface TodoTask {
  id: string;
  list_id: string | null;
  list_name: string | null;
  title: string;
  notes: string | null;
  important: number;
  due_date: string | null;
  my_day: string | null;
  /** Lembrete (ISO) e quando ele saiu. */
  remind_at: string | null;
  reminded_at: string | null;
  /** Regra de repetição (JSON de `Recurrence`) ou nulo. */
  recurrence: string | null;
  done: number;
  done_at: string | null;
  position: number;
  created_at: string;
  steps_total: number;
  steps_done: number;
}

const ymd = (v: string | null | undefined, field: string): string | null => {
  const t = optionalText(v);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(new Date(`${t}T00:00:00`).getTime())) throw new ValidationError(`${field} inválida.`);
  return t;
};

function ownerOf(ctx: DbContext): string {
  if (!ctx.userId) throw new ValidationError("Escolha um usuário para usar o To Do.");
  return ctx.userId;
}

function requireList(db: DatabaseSync, ctx: DbContext, id: string): { id: string; name: string } {
  const l = one<{ id: string; name: string }>(db, "SELECT id, name FROM todo_list WHERE id = ? AND owner_id = ? AND deleted_at IS NULL", id, ownerOf(ctx));
  if (!l) throw new ValidationError("Lista não encontrada.");
  return l;
}

function requireTask(db: DatabaseSync, ctx: DbContext, id: string): { id: string; list_id: string | null; done: number; due_date: string | null; recurrence: string | null } {
  const t = one<{ id: string; list_id: string | null; done: number; due_date: string | null; recurrence: string | null }>(
    db,
    "SELECT id, list_id, done, due_date, recurrence FROM todo_task WHERE id = ? AND owner_id = ? AND deleted_at IS NULL",
    id,
    ownerOf(ctx),
  );
  if (!t) throw new ValidationError("Tarefa não encontrada.");
  return t;
}

// ---------- Listas ----------

export function listTodoLists(db: DatabaseSync, ctx: DbContext): TodoList[] {
  return many<TodoList>(
    db,
    `SELECT l.id, l.name, l.color, l.position,
       (SELECT COUNT(*) FROM todo_task t WHERE t.list_id = l.id AND t.done = 0 AND t.deleted_at IS NULL) AS pending
     FROM todo_list l WHERE l.owner_id = ? AND l.deleted_at IS NULL ORDER BY l.position, l.name COLLATE NOCASE`,
    ownerOf(ctx),
  );
}

/** Contadores das listas inteligentes (pendentes). `today` = AAAA-MM-DD local. */
export function todoCounts(db: DatabaseSync, ctx: DbContext, today = todayYmd()): Record<TodoSmart, number> {
  const c = one<Record<TodoSmart, number>>(
    db,
    `SELECT
       COALESCE(SUM(my_day = ?), 0) AS meudia,
       COALESCE(SUM(important = 1), 0) AS importante,
       COALESCE(SUM(due_date IS NOT NULL), 0) AS planejado,
       COUNT(*) AS todas,
       COALESCE(SUM(list_id IS NULL), 0) AS tarefas
     FROM todo_task WHERE owner_id = ? AND done = 0 AND deleted_at IS NULL`,
    today,
    ownerOf(ctx),
  );
  return c ?? { meudia: 0, importante: 0, planejado: 0, todas: 0, tarefas: 0 };
}

export function createTodoList(db: DatabaseSync, ctx: DbContext, input: { name: string; color?: string }): string {
  const owner = ownerOf(ctx);
  const name = requireText(input.name, "Dê um nome à lista.").slice(0, 80);
  const color = input.color && (LIST_COLORS as readonly string[]).includes(input.color) ? input.color : "blue";
  const last = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM todo_list WHERE owner_id = ? AND deleted_at IS NULL", owner)?.p ?? 0;
  return insertRow(db, ctx, "todo_list", { owner_id: owner, name, color, position: last + 1 });
}

export function updateTodoList(db: DatabaseSync, ctx: DbContext, id: string, patch: { name?: string; color?: string }): void {
  requireList(db, ctx, id);
  const data: Record<string, SqlValue> = {};
  if (patch.name !== undefined) data.name = requireText(patch.name, "Dê um nome à lista.").slice(0, 80);
  if (patch.color !== undefined) {
    if (!(LIST_COLORS as readonly string[]).includes(patch.color)) throw new ValidationError("Cor inválida.");
    data.color = patch.color;
  }
  if (Object.keys(data).length) updateRow(db, ctx, "todo_list", id, data);
}

/** Nova ordem das listas (ids na ordem desejada). */
export function reorderTodoLists(db: DatabaseSync, ctx: DbContext, ids: string[]): void {
  withTransaction(db, () => {
    ids.forEach((id, i) => {
      requireList(db, ctx, id);
      updateRow(db, ctx, "todo_list", id, { position: i + 1 });
    });
  });
}

/** Exclui a lista e as tarefas dela (vai tudo junto para a lixeira e volta junto). */
export function deleteTodoList(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  requireList(db, ctx, id);
  return moveToTrash(db, ctx, "todo_list", id, () => {
    for (const t of many<{ id: string }>(db, "SELECT id FROM todo_task WHERE list_id = ? AND deleted_at IS NULL", id)) deleteTaskRows(db, ctx, t.id);
    softDelete(db, ctx, "todo_list", id);
  });
}

// ---------- Tarefas ----------

const TASK_COLS = `t.id, t.list_id, l.name AS list_name, t.title, t.notes, t.important, t.due_date, t.my_day, t.remind_at, t.reminded_at, t.recurrence, t.done, t.done_at, t.position, t.created_at,
  (SELECT COUNT(*) FROM todo_step s WHERE s.task_id = t.id AND s.deleted_at IS NULL) AS steps_total,
  (SELECT COUNT(*) FROM todo_step s WHERE s.task_id = t.id AND s.deleted_at IS NULL AND s.done = 1) AS steps_done`;

/** Tarefas de uma lista (ou lista inteligente): abertas e concluídas. */
export function listTodoTasks(
  db: DatabaseSync,
  ctx: DbContext,
  view: TodoView,
  opts: { search?: string; today?: string } = {},
): { open: TodoTask[]; done: TodoTask[] } {
  const where = ["t.owner_id = ?", "t.deleted_at IS NULL"];
  const params: SqlValue[] = [ownerOf(ctx)];
  if ("listId" in view) {
    requireList(db, ctx, view.listId);
    where.push("t.list_id = ?");
    params.push(view.listId);
  } else if (view.smart === "meudia") {
    // Meu Dia "zera" à meia-noite: vale só o que foi posto hoje.
    where.push("t.my_day = ?");
    params.push(opts.today ?? todayYmd());
  } else if (view.smart === "importante") where.push("t.important = 1");
  else if (view.smart === "planejado") where.push("t.due_date IS NOT NULL");
  else if (view.smart === "tarefas") where.push("t.list_id IS NULL");
  if (opts.search?.trim()) {
    where.push("(t.title LIKE ? OR t.notes LIKE ?)");
    params.push(`%${opts.search.trim()}%`, `%${opts.search.trim()}%`);
  }
  const rows = many<TodoTask>(
    db,
    `SELECT ${TASK_COLS} FROM todo_task t LEFT JOIN todo_list l ON l.id = t.list_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${"smart" in view && view.smart === "planejado" ? "t.due_date, " : ""}t.position DESC, t.created_at DESC`,
    ...params,
  );
  // Em "Todas" e nas inteligentes, as concluídas não aparecem (como no Microsoft To Do), exceto numa lista.
  const showDone = "listId" in view || view.smart === "tarefas" || view.smart === "meudia";
  return {
    open: rows.filter((r) => !r.done),
    done: showDone ? rows.filter((r) => r.done).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "")) : [],
  };
}

export function getTodoTask(db: DatabaseSync, ctx: DbContext, id: string): (TodoTask & { steps: TodoStep[] }) | null {
  requireTask(db, ctx, id);
  const t = one<TodoTask>(db, `SELECT ${TASK_COLS} FROM todo_task t LEFT JOIN todo_list l ON l.id = t.list_id WHERE t.id = ?`, id);
  if (!t) return null;
  const steps = many<TodoStep>(db, "SELECT id, title, done, position FROM todo_step WHERE task_id = ? AND deleted_at IS NULL ORDER BY position, created_at", id);
  return { ...t, steps };
}

export interface TodoTaskInput {
  title: string;
  /** Pôr em "Meu Dia" (hoje) — ou tirar (false). */
  myDay?: boolean;
  listId?: string | null;
  important?: boolean;
  dueDate?: string | null;
  notes?: string | null;
  /** Lembrete (ISO com data e hora) ou null para tirar. */
  remindAt?: string | null;
  /** Repetir: regra ou null para não repetir. Sem vencimento, vence hoje. */
  recurrence?: Recurrence | null;
}

const isoOrNull = (v: string | null | undefined): string | null => {
  const t = optionalText(v);
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) throw new ValidationError("Data e hora do lembrete inválidas.");
  return d.toISOString();
};
const recurrenceOrNull = (v: Recurrence | null | undefined): string | null => {
  if (!v) return null;
  const r = parseRecurrence(v);
  if (!r) throw new ValidationError("Repetição inválida.");
  return JSON.stringify(r);
};

/** Nova tarefa (fica no topo da lista). */
export function createTodoTask(db: DatabaseSync, ctx: DbContext, input: TodoTaskInput): string {
  const owner = ownerOf(ctx);
  const title = requireText(input.title, "Escreva a tarefa.").slice(0, 300);
  if (input.listId) requireList(db, ctx, input.listId);
  const top = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM todo_task WHERE owner_id = ?", owner)?.p ?? 0;
  return insertRow(db, ctx, "todo_task", {
    owner_id: owner,
    list_id: input.listId ?? null,
    title,
    notes: optionalText(input.notes),
    important: input.important ? 1 : 0,
    due_date: ymd(input.dueDate, "Data de vencimento") ?? (input.recurrence ? todayYmd() : null),
    my_day: input.myDay ? todayYmd() : null,
    remind_at: isoOrNull(input.remindAt),
    recurrence: recurrenceOrNull(input.recurrence),
    position: top + 1,
  });
}

export function updateTodoTask(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<TodoTaskInput> & { done?: boolean }): string | null {
  const cur = requireTask(db, ctx, id);
  const data: Record<string, SqlValue> = {};
  if (patch.title !== undefined) data.title = requireText(patch.title, "Escreva a tarefa.").slice(0, 300);
  if (patch.notes !== undefined) data.notes = optionalText(patch.notes);
  if (patch.important !== undefined) data.important = patch.important ? 1 : 0;
  if (patch.dueDate !== undefined) data.due_date = ymd(patch.dueDate, "Data de vencimento");
  if (patch.myDay !== undefined) data.my_day = patch.myDay ? todayYmd() : null;
  if (patch.listId !== undefined && patch.listId !== cur.list_id) {
    if (patch.listId) requireList(db, ctx, patch.listId);
    data.list_id = patch.listId;
  }
  if (patch.remindAt !== undefined) {
    data.remind_at = isoOrNull(patch.remindAt);
    data.reminded_at = null;
  }
  if (patch.recurrence !== undefined) {
    data.recurrence = recurrenceOrNull(patch.recurrence);
    // Repetir precisa de um vencimento: sem ele, vence hoje (como no Microsoft To Do).
    if (data.recurrence && !(data.due_date ?? (patch.dueDate === undefined ? cur.due_date : null))) data.due_date = todayYmd();
  }
  let next: string | null = null;
  withTransaction(db, () => {
    if (patch.done !== undefined && (patch.done ? 1 : 0) !== cur.done) {
      data.done = patch.done ? 1 : 0;
      data.done_at = patch.done ? nowIso() : null;
      // Concluiu uma tarefa que se repete: cria a próxima e esta deixa de repetir.
      if (patch.done && cur.recurrence) {
        next = createNextOccurrence(db, ctx, id);
        if (next) data.recurrence = null;
      }
    }
    if (Object.keys(data).length) updateRow(db, ctx, "todo_task", id, data);
  });
  return next;
}

/** Próxima ocorrência de uma tarefa que se repete: mesma lista, título, observações, estrela e etapas (desmarcadas). */
function createNextOccurrence(db: DatabaseSync, ctx: DbContext, id: string): string | null {
  const t = one<{ list_id: string | null; title: string; notes: string | null; important: number; due_date: string | null; remind_at: string | null; recurrence: string | null }>(
    db,
    "SELECT list_id, title, notes, important, due_date, remind_at, recurrence FROM todo_task WHERE id = ?",
    id,
  );
  const rule = t && parseRecurrence(t.recurrence);
  if (!t || !rule) return null;
  const today = todayYmd();
  const due = nextOccurrence(t.due_date ?? today, rule, today);
  const owner = ownerOf(ctx);
  const top = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM todo_task WHERE owner_id = ?", owner)?.p ?? 0;
  const newId = insertRow(db, ctx, "todo_task", {
    owner_id: owner,
    list_id: t.list_id,
    title: t.title,
    notes: t.notes,
    important: t.important,
    due_date: due,
    remind_at: t.remind_at ? sameTimeOn(t.remind_at, due) : null,
    recurrence: t.recurrence,
    position: top + 1,
  });
  for (const s of many<{ title: string; position: number }>(db, "SELECT title, position FROM todo_step WHERE task_id = ? AND deleted_at IS NULL ORDER BY position", id))
    insertRow(db, ctx, "todo_step", { task_id: newId, title: s.title, position: s.position });
  return newId;
}

// ---------- Lembretes e contador ----------

export interface TodoReminder {
  id: string;
  title: string;
  list_name: string | null;
  due_date: string | null;
  remind_at: string;
}

/**
 * Lembretes que chegaram (o service worker pergunta a cada minuto): devolve e
 * marca como avisados, para não repetir. Concluída/excluída não avisa.
 */
export function todoDueReminders(db: DatabaseSync, ctx: DbContext, now = nowIso()): TodoReminder[] {
  if (!ctx.userId) return [];
  const due = many<TodoReminder>(
    db,
    `SELECT t.id, t.title, l.name AS list_name, t.due_date, t.remind_at FROM todo_task t LEFT JOIN todo_list l ON l.id = t.list_id
     WHERE t.owner_id = ? AND t.deleted_at IS NULL AND t.done = 0 AND t.reminded_at IS NULL AND t.remind_at IS NOT NULL AND t.remind_at <= ?
     ORDER BY t.remind_at LIMIT 20`,
    ctx.userId,
    now,
  );
  for (const r of due) run(db, "UPDATE todo_task SET reminded_at = ? WHERE id = ?", now, r.id);
  return due;
}

/** "Adiar 10 min" do aviso: o lembrete volta a valer daqui a `minutes`. */
export function snoozeTodoReminder(db: DatabaseSync, ctx: DbContext, id: string, minutes = 10): void {
  requireTask(db, ctx, id);
  updateRow(db, ctx, "todo_task", id, { remind_at: new Date(Date.now() + minutes * 60_000).toISOString(), reminded_at: null });
}

/** Contador do menu "To Do": abertas no Meu Dia de hoje, vencidas/que vencem hoje ou com lembrete que já chegou. */
export function todoBadge(db: DatabaseSync, ctx: DbContext, today = todayYmd(), now = nowIso()): number {
  if (!ctx.userId) return 0;
  return (
    one<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM todo_task WHERE owner_id = ? AND deleted_at IS NULL AND done = 0
       AND (my_day = ? OR due_date <= ? OR remind_at <= ?)`,
      ctx.userId,
      today,
      today,
      now,
    )?.n ?? 0
  );
}

function deleteTaskRows(db: DatabaseSync, ctx: DbContext, id: string): void {
  for (const s of many<{ id: string }>(db, "SELECT id FROM todo_step WHERE task_id = ? AND deleted_at IS NULL", id)) softDelete(db, ctx, "todo_step", s.id);
  softDelete(db, ctx, "todo_task", id);
}

export function deleteTodoTask(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  requireTask(db, ctx, id);
  return moveToTrash(db, ctx, "todo_task", id, () => deleteTaskRows(db, ctx, id));
}

// ---------- Meu Dia: sugestões ----------

export interface TodoSuggestions {
  /** Estavam em Meu Dia em dias anteriores e não foram concluídas. */
  earlier: TodoTask[];
  /** Vencem hoje ou já venceram (fora do Meu Dia de hoje). */
  due: TodoTask[];
  /** Importantes ainda abertas (fora das de cima). */
  important: TodoTask[];
}

/** Sugestões para montar o Meu Dia (como a lâmpada do Microsoft To Do). */
export function todoSuggestions(db: DatabaseSync, ctx: DbContext, today = todayYmd()): TodoSuggestions {
  const base = `SELECT ${TASK_COLS} FROM todo_task t LEFT JOIN todo_list l ON l.id = t.list_id
    WHERE t.owner_id = ? AND t.deleted_at IS NULL AND t.done = 0 AND (t.my_day IS NULL OR t.my_day <> ?)`;
  const owner = ownerOf(ctx);
  const earlier = many<TodoTask>(db, `${base} AND t.my_day IS NOT NULL ORDER BY t.my_day DESC, t.position DESC LIMIT 20`, owner, today);
  const seen = new Set(earlier.map((t) => t.id));
  const due = many<TodoTask>(db, `${base} AND t.due_date <= ? ORDER BY t.due_date, t.position DESC LIMIT 20`, owner, today, today).filter((t) => !seen.has(t.id));
  due.forEach((t) => seen.add(t.id));
  const important = many<TodoTask>(db, `${base} AND t.important = 1 ORDER BY t.position DESC LIMIT 20`, owner, today).filter((t) => !seen.has(t.id));
  return { earlier, due, important };
}

// ---------- Etapas ----------

export function addTodoStep(db: DatabaseSync, ctx: DbContext, taskId: string, title: string): string {
  requireTask(db, ctx, taskId);
  const last = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM todo_step WHERE task_id = ? AND deleted_at IS NULL", taskId)?.p ?? 0;
  return insertRow(db, ctx, "todo_step", { task_id: taskId, title: requireText(title, "Escreva a etapa.").slice(0, 300), position: last + 1 });
}

function requireStep(db: DatabaseSync, ctx: DbContext, id: string): string {
  const s = one<{ task_id: string }>(db, "SELECT task_id FROM todo_step WHERE id = ? AND deleted_at IS NULL", id);
  if (!s) throw new ValidationError("Etapa não encontrada.");
  requireTask(db, ctx, s.task_id);
  return s.task_id;
}

export function updateTodoStep(db: DatabaseSync, ctx: DbContext, id: string, patch: { title?: string; done?: boolean }): void {
  requireStep(db, ctx, id);
  const data: Record<string, SqlValue> = {};
  if (patch.title !== undefined) data.title = requireText(patch.title, "Escreva a etapa.").slice(0, 300);
  if (patch.done !== undefined) data.done = patch.done ? 1 : 0;
  if (Object.keys(data).length) updateRow(db, ctx, "todo_step", id, data);
}

/** Etapa removida sai direto (é parte da tarefa; não vai sozinha para a lixeira). */
export function deleteTodoStep(db: DatabaseSync, ctx: DbContext, id: string): void {
  requireStep(db, ctx, id);
  softDelete(db, ctx, "todo_step", id);
}
