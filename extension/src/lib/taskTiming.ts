// Situação de prazo de uma tarefa para o painel: duração (início →
// finalização) e quantos dias faltam / de atraso. Conta em dias de
// calendário no fuso local ("vence hoje", "falta 1 dia").
export type TimingTone = "danger" | "warning" | "ok" | "muted";

export interface TaskTiming {
  /** Ex.: "faltam 3 dias", "vence hoje", "atrasada há 2 dias", "começa amanhã". */
  label: string;
  tone: TimingTone;
  /** Duração planejada (só com finalização), ex.: "5 dias", "mesmo dia". */
  span: string | null;
}

const DAY = 86_400_000;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Diferença em dias de calendário (b − a). */
const calDays = (a: Date, b: Date) => Math.round((dayStart(b) - dayStart(a)) / DAY);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Início do dia (fuso local). */
export function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Atrasada = pendente com a finalização vencida; sem finalização, com o início
 * antes de hoje (começou num dia que já passou e não foi concluída).
 */
export function isOverdue(t: { due_at: string; end_at: string | null; done: number | boolean }, now = new Date()): boolean {
  if (t.done) return false;
  return t.end_at ? new Date(t.end_at) < now : new Date(t.due_at) < startOfDay(now);
}

/** Data de referência do atraso (finalização ou, sem ela, o início). */
export const overdueFrom = (t: { due_at: string; end_at: string | null }) => t.end_at ?? t.due_at;

export function taskTiming(t: { due_at: string; end_at: string | null; done: number | boolean; done_at?: string | null }, now = new Date()): TaskTiming {
  const start = new Date(t.due_at);
  const end = t.end_at ? new Date(t.end_at) : null;
  const span = end ? (calDays(start, end) === 0 ? "mesmo dia" : plural(calDays(start, end), "dia", "dias")) : null;

  if (t.done) {
    const at = t.done_at ? new Date(t.done_at) : null;
    if (end && at && at > end) {
      const late = calDays(end, at);
      return { label: late > 0 ? `concluída com ${plural(late, "dia", "dias")} de atraso` : "concluída (após o horário)", tone: "muted", span };
    }
    return { label: end ? "concluída no prazo" : "concluída", tone: "muted", span };
  }

  if (end) {
    if (end < now) {
      const late = calDays(end, now);
      return { label: late === 0 ? "atrasada (venceu hoje)" : `atrasada há ${plural(late, "dia", "dias")}`, tone: "danger", span };
    }
    const left = calDays(now, end);
    if (left === 0) return { label: "vence hoje", tone: "warning", span };
    return { label: left === 1 ? "falta 1 dia" : `faltam ${left} dias`, tone: left <= 2 ? "warning" : "ok", span };
  }

  // Sem finalização: só a referência do início.
  const toStart = calDays(now, start);
  if (start > now) {
    if (toStart === 0) return { label: "começa hoje", tone: "ok", span };
    return { label: toStart === 1 ? "começa amanhã" : `começa em ${toStart} dias`, tone: "ok", span };
  }
  const since = -toStart;
  // Começou num dia que já passou e não foi concluída: atrasada (mesma regra de isOverdue).
  if (since > 0) return { label: `atrasada há ${plural(since, "dia", "dias")} (sem finalização)`, tone: "danger", span };
  return { label: "iniciada hoje · sem prazo", tone: "muted", span };
}
