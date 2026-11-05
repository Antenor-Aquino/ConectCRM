// To Do (spec 15): datas de vencimento — selo da tarefa e grupos do Planejado.
// Datas no formato AAAA-MM-DD, comparadas no dia local.

export const todayYmd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return todayYmd(new Date(y!, m! - 1, d! + n));
};

const WEEKDAY = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

/** Selo do vencimento: "Hoje", "Amanhã", "Atrasada · 26/11", "sex., 28/11". */
export function dueLabel(due: string, today = todayYmd()): { text: string; tone: "danger" | "brand" | "muted" } {
  const [y, m, d] = due.split("-").map(Number);
  const dm = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}${y !== Number(today.slice(0, 4)) ? `/${y}` : ""}`;
  if (due < today) return { text: `Atrasada · ${dm}`, tone: "danger" };
  if (due === today) return { text: "Vence hoje", tone: "brand" };
  if (due === addDays(today, 1)) return { text: "Vence amanhã", tone: "muted" };
  return { text: `${WEEKDAY[new Date(y!, m! - 1, d!).getDay()]}, ${dm}`, tone: "muted" };
}

export type PlannedGroup = "Atrasadas" | "Hoje" | "Amanhã" | "Esta semana" | "Depois";
export const PLANNED_GROUPS: PlannedGroup[] = ["Atrasadas", "Hoje", "Amanhã", "Esta semana", "Depois"];

/** Grupo do Planejado: "Esta semana" vai até o sábado. */
export function plannedGroup(due: string, today = todayYmd()): PlannedGroup {
  if (due < today) return "Atrasadas";
  if (due === today) return "Hoje";
  if (due === addDays(today, 1)) return "Amanhã";
  const [y, m, d] = today.split("-").map(Number);
  const saturday = addDays(today, 6 - new Date(y!, m! - 1, d!).getDay());
  return due <= saturday ? "Esta semana" : "Depois";
}

// ---------- Repetir (fase 3) ----------

export type RecurrenceUnit = "day" | "week" | "month" | "year";
/** A cada `every` dias/semanas/meses/anos; na semana, nos `weekdays` (0 = domingo). */
export interface Recurrence {
  every: number;
  unit: RecurrenceUnit;
  weekdays?: number[];
}

const dow = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getDay();
};

/** Valida e normaliza (texto JSON do banco ou objeto da tela). Inválida → null. */
export function parseRecurrence(v: unknown): Recurrence | null {
  let r: unknown = v;
  if (typeof v === "string") {
    try {
      r = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const unit = o.unit;
  if (unit !== "day" && unit !== "week" && unit !== "month" && unit !== "year") return null;
  const every = Math.min(99, Math.max(1, Math.floor(Number(o.every) || 1)));
  const weekdays =
    unit === "week" && Array.isArray(o.weekdays)
      ? [...new Set(o.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
      : undefined;
  return weekdays?.length ? { every, unit, weekdays } : { every, unit };
}

/** Mês/ano somados mantendo o dia (31 → último dia do mês, 29/02 → 28/02). */
function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const first = new Date(y!, m! - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return todayYmd(new Date(first.getFullYear(), first.getMonth(), Math.min(d!, last)));
}

/** Próxima data depois de `from` segundo a regra. */
export function nextDue(from: string, r: Recurrence): string {
  if (r.unit === "day") return addDays(from, r.every);
  if (r.unit === "month") return addMonths(from, r.every);
  if (r.unit === "year") return addMonths(from, 12 * r.every);
  if (!r.weekdays?.length) return addDays(from, 7 * r.every);
  // Semanas contadas a partir da semana (domingo) de `from`.
  const weekStart = addDays(from, -dow(from));
  for (let i = 1; i <= 7 * r.every + 7; i++) {
    const d = addDays(from, i);
    const weeks = Math.round((new Date(`${addDays(d, -dow(d))}T12:00:00`).getTime() - new Date(`${weekStart}T12:00:00`).getTime()) / (7 * 86_400_000));
    if (weeks % r.every === 0 && r.weekdays.includes(dow(d))) return d;
  }
  return addDays(from, 7 * r.every);
}

/** Próxima ocorrência que não fique para trás de hoje (tarefa repetida atrasada não gera outra atrasada). */
export function nextOccurrence(from: string, r: Recurrence, today = todayYmd()): string {
  let d = nextDue(from, r);
  for (let i = 0; d < today && i < 1000; i++) d = nextDue(d, r);
  return d;
}

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "Diariamente", "Dias da semana", "Semanalmente (seg, qua)", "A cada 2 meses"… */
export function recurrenceLabel(r: Recurrence): string {
  const days = r.weekdays?.length ? ` (${r.weekdays.map((d) => WEEKDAY_SHORT[d]).join(", ")})` : "";
  if (r.unit === "week" && r.every === 1 && r.weekdays?.join() === "1,2,3,4,5") return "Dias da semana";
  if (r.every === 1) return { day: "Diariamente", week: "Semanalmente", month: "Mensalmente", year: "Anualmente" }[r.unit] + days;
  return `A cada ${r.every} ${{ day: "dias", week: "semanas", month: "meses", year: "anos" }[r.unit]}${days}`;
}

/** Hora local "HH:MM" de um ISO e o ISO da mesma hora em outro dia. */
export function sameTimeOn(iso: string, ymd: string): string {
  const t = new Date(iso);
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, m! - 1, d!, t.getHours(), t.getMinutes()).toISOString();
}

// ---------- Ordenar (fase 4) ----------

export type TodoSortBy = "manual" | "importancia" | "vencimento" | "alfabetica" | "criacao";
export const TODO_SORTS: { id: Exclude<TodoSortBy, "manual">; label: string }[] = [
  { id: "importancia", label: "Importância" },
  { id: "vencimento", label: "Data de vencimento" },
  { id: "alfabetica", label: "Ordem alfabética" },
  { id: "criacao", label: "Data de criação" },
];

type Sortable = { title: string; important: number; due_date: string | null; created_at: string };

/**
 * Ordena as tarefas (a ordem manual é a que vem do banco). "asc" é o sentido
 * natural de cada critério: importantes primeiro, vencimento mais próximo
 * primeiro (sem data no fim), A→Z, mais nova primeiro.
 */
export function sortTasks<T extends Sortable>(tasks: T[], by: TodoSortBy, dir: "asc" | "desc" = "asc"): T[] {
  if (by === "manual") return tasks;
  const cmp: (a: T, b: T) => number =
    by === "importancia"
      ? (a, b) => b.important - a.important
      : by === "vencimento"
        ? (a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")
        : by === "alfabetica"
          ? (a, b) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base", numeric: true })
          : (a, b) => b.created_at.localeCompare(a.created_at);
  const sign = dir === "asc" ? 1 : -1;
  // Estável: empate mantém a ordem manual.
  return tasks
    .map((t, i) => [t, i] as const)
    .sort(([a, i], [b, j]) => sign * cmp(a, b) || i - j)
    .map(([t]) => t);
}
