// Regras de recorrência das atividades (spec 02, Atividades recorrentes).
// Funções puras: dada a regra e o início da série, devolvem as datas das
// ocorrências (hora local do início mantida em todas). Usadas pelo banco
// (db/activitySeries.ts) e pelo formulário (resumo "Toda segunda...").

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

export type RecurrenceEnd = { type: "never" } | { type: "until"; date: string } | { type: "count"; count: number };

export interface RecurrenceRule {
  freq: Freq;
  /** A cada N dias/semanas/meses/anos (>= 1). "A cada X dias" = daily com interval X. */
  interval: number;
  /** Diária: só segunda a sexta. */
  workdaysOnly?: boolean;
  /** Semanal: dias da semana (0 = domingo … 6 = sábado). Vazio = o dia do início. */
  weekdays?: number[];
  /** Mensal: mesmo dia do mês ("day") ou "2ª terça" ("weekday", conforme o início). */
  monthly?: "day" | "weekday";
  end: RecurrenceEnd;
  /** Próxima só depois de concluir a atual (contando da conclusão). */
  afterDone?: boolean;
}

export const MAX_INTERVAL = 365;
export const MAX_COUNT = 1000;

const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const ORDINAL = ["", "1ª", "2ª", "3ª", "4ª"];

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const at = (base: Date, y: number, m: number, d: number) => new Date(y, m, d, base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "2ª terça" do mês do início: ordinal 1..4, ou -1 = última. */
export function monthlyOrdinal(start: Date): { nth: number; weekday: number } {
  const day = start.getDate();
  const nth = day + 7 > daysInMonth(start.getFullYear(), start.getMonth()) ? -1 : Math.ceil(day / 7);
  return { nth, weekday: start.getDay() };
}

function nthWeekdayOf(base: Date, y: number, m: number, nth: number, weekday: number): Date {
  if (nth === -1) {
    const last = daysInMonth(y, m);
    const lastDow = new Date(y, m, last).getDay();
    return at(base, y, m, last - ((lastDow - weekday + 7) % 7));
  }
  const firstDow = new Date(y, m, 1).getDay();
  return at(base, y, m, 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7);
}

export function validateRule(rule: RecurrenceRule): string | null {
  if (!["daily", "weekly", "monthly", "yearly"].includes(rule.freq)) return "Frequência inválida.";
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL) return `O intervalo deve ser de 1 a ${MAX_INTERVAL}.`;
  if (rule.weekdays && rule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Dia da semana inválido.";
  if (rule.end.type === "until" && !/^\d{4}-\d{2}-\d{2}$/.test(rule.end.date)) return "Data final inválida.";
  if (rule.end.type === "count" && (!Number.isInteger(rule.end.count) || rule.end.count < 1 || rule.end.count > MAX_COUNT))
    return `O número de vezes deve ser de 1 a ${MAX_COUNT}.`;
  return null;
}

/**
 * Ocorrências da série em ordem, a partir do início (índice 1 = a primeira),
 * até `to` (inclusive), respeitando o fim da regra. `afterDone` não entra aqui
 * (a próxima depende da conclusão: ver nextAfterDone).
 */
export function occurrences(rule: RecurrenceRule, start: Date, to: Date, max = 5000): { index: number; at: Date }[] {
  const out: { index: number; at: Date }[] = [];
  const until = rule.end.type === "until" ? rule.end.date : null;
  const count = rule.end.type === "count" ? rule.end.count : Infinity;
  const push = (d: Date): boolean => {
    if (d < start) return true;
    if (d > to || (until && ymd(d) > until) || out.length >= count || out.length >= max) return false;
    out.push({ index: out.length + 1, at: d });
    return true;
  };
  const n = rule.interval;
  // Teto de passos para não girar à toa (ex.: dias úteis num intervalo só de fins de semana).
  for (let k = 0; k < 20000; k++) {
    if (rule.freq === "daily") {
      const d = at(start, start.getFullYear(), start.getMonth(), start.getDate() + k * n);
      if (rule.workdaysOnly && isWeekend(d)) {
        if (d > to) break;
        continue;
      }
      if (!push(d)) break;
    } else if (rule.freq === "weekly") {
      const days = rule.weekdays?.length ? [...new Set(rule.weekdays)].sort() : [start.getDay()];
      const weekStart = start.getDate() - start.getDay() + k * 7 * n;
      let stop = false;
      for (const wd of days) {
        if (!push(at(start, start.getFullYear(), start.getMonth(), weekStart + wd))) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    } else if (rule.freq === "monthly") {
      const total = start.getMonth() + k * n;
      const y = start.getFullYear() + Math.floor(total / 12);
      const m = ((total % 12) + 12) % 12;
      let d: Date;
      if (rule.monthly === "weekday") {
        const o = monthlyOrdinal(start);
        d = nthWeekdayOf(start, y, m, o.nth, o.weekday);
      } else d = at(start, y, m, Math.min(start.getDate(), daysInMonth(y, m)));
      if (!push(d)) break;
    } else {
      const y = start.getFullYear() + k * n;
      if (!push(at(start, y, start.getMonth(), Math.min(start.getDate(), daysInMonth(y, start.getMonth()))))) break;
    }
  }
  return out;
}

/** "Repetir só depois de concluir": a próxima, contando da conclusão (na hora do início da série). */
export function nextAfterDone(rule: RecurrenceRule, seriesStart: Date, doneAt: Date): Date {
  const n = rule.interval;
  const y = doneAt.getFullYear();
  const m = doneAt.getMonth();
  const d = doneAt.getDate();
  if (rule.freq === "daily") {
    let next = at(seriesStart, y, m, d + n);
    while (rule.workdaysOnly && isWeekend(next)) next = at(seriesStart, next.getFullYear(), next.getMonth(), next.getDate() + 1);
    return next;
  }
  if (rule.freq === "weekly") return at(seriesStart, y, m, d + 7 * n);
  if (rule.freq === "monthly") {
    const ty = y + Math.floor((m + n) / 12);
    const tm = (m + n) % 12;
    return at(seriesStart, ty, tm, Math.min(d, daysInMonth(ty, tm)));
  }
  return at(seriesStart, y + n, m, Math.min(d, daysInMonth(y + n, m)));
}

/** Frase da regra: "Toda segunda e quarta às 09:00, até 30/12/2026". */
export function describeRule(rule: RecurrenceRule, start: Date): string {
  const n = rule.interval;
  const hm = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}` : (xs[0] ?? ""));
  let base: string;
  if (rule.freq === "daily") {
    if (n === 1) base = rule.workdaysOnly ? "Todo dia útil (segunda a sexta)" : "Todo dia";
    else base = `A cada ${n} dias${rule.workdaysOnly ? " (só dias úteis)" : ""}`;
  } else if (rule.freq === "weekly") {
    const days = rule.weekdays?.length ? [...new Set(rule.weekdays)].sort() : [start.getDay()];
    const names = days.length >= 3 ? list(days.map((d) => WEEKDAY_SHORT[d]!)) : list(days.map((d) => WEEKDAY[d]!));
    base = n === 1 ? `Toda semana: ${names}` : `A cada ${n} semanas: ${names}`;
  } else if (rule.freq === "monthly") {
    const every = n === 1 ? "Todo mês" : `A cada ${n} meses`;
    if (rule.monthly === "weekday") {
      const o = monthlyOrdinal(start);
      base = `${every}, na ${o.nth === -1 ? "última" : ORDINAL[o.nth]} ${WEEKDAY[o.weekday]}`;
    } else base = `${every}, no dia ${start.getDate()}${start.getDate() > 28 ? " (ou no último dia do mês)" : ""}`;
  } else {
    const dm = start.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
    base = n === 1 ? `Todo ano, em ${dm}` : `A cada ${n} anos, em ${dm}`;
  }
  const end =
    rule.end.type === "until"
      ? `, até ${rule.end.date.split("-").reverse().join("/")}`
      : rule.end.type === "count"
        ? `, ${rule.end.count} ${rule.end.count === 1 ? "vez" : "vezes"}`
        : ", sem data final";
  return `${base} às ${hm}${end}${rule.afterDone ? " — a próxima só depois de concluir a atual" : ""}`;
}
