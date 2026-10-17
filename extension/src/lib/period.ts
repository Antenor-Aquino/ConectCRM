// Períodos dos relatórios, sempre no fuso local; o banco guarda ISO (UTC).
export type PeriodPreset = "mes" | "mes-passado" | "trimestre" | "ano" | "12-meses" | "custom";

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  mes: "Este mês",
  "mes-passado": "Mês passado",
  trimestre: "Últimos 3 meses",
  ano: "Este ano",
  "12-meses": "Últimos 12 meses",
  custom: "Personalizado",
};

export interface Period {
  /** Datas locais "AAAA-MM-DD", fim inclusive (para os campos de data). */
  start: string;
  end: string;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function presetPeriod(p: Exclude<PeriodPreset, "custom">, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  const range = (a: Date, b: Date) => ({ start: ymd(a), end: ymd(b) });
  switch (p) {
    case "mes":
      return range(new Date(y, m, 1), new Date(y, m + 1, 0));
    case "mes-passado":
      return range(new Date(y, m - 1, 1), new Date(y, m, 0));
    case "trimestre":
      return range(new Date(y, m - 2, 1), new Date(y, m + 1, 0));
    case "ano":
      return range(new Date(y, 0, 1), new Date(y, 11, 31));
    case "12-meses":
      return range(new Date(y, m - 11, 1), new Date(y, m + 1, 0));
  }
}

/** Período local → intervalo ISO [from, to) para o banco. */
export function periodToIso(p: Period): { from: string; to: string } {
  const [ys, ms, ds] = p.start.split("-").map(Number);
  const [ye, me, de] = p.end.split("-").map(Number);
  return { from: new Date(ys!, ms! - 1, ds!).toISOString(), to: new Date(ye!, me! - 1, de! + 1).toISOString() };
}

export function formatPeriod(p: Period): string {
  const f = (s: string) => s.split("-").reverse().join("/");
  return `${f(p.start)} a ${f(p.end)}`;
}

/** "2026-03" → "mar/26". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". de ", "/").replace(".", "");
}
