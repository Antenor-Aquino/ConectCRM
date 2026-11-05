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
