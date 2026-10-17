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
  return { label: since === 0 ? "iniciada hoje · sem prazo" : `iniciada há ${plural(since, "dia", "dias")} · sem prazo`, tone: "muted", span };
}
