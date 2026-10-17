// Gráficos dos relatórios: wrappers finos sobre Chart.js (mesmo padrão da
// gestao-financeira-extensao, sem react-chartjs-2). Cores da paleta validada
// (slots azul/laranja, passos próprios no tema escuro), marcas finas, grade
// em linha fina e sempre uma tabela equivalente ("Ver tabela").
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip, type ChartConfiguration } from "chart.js";
import { Table2, BarChart3 } from "lucide-react";
import { cn } from "@tailadmin";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/** Slots categóricos na ordem fixa (validados com o validador de paleta). */
const SERIES = {
  light: ["#2a78d6", "#eb6834"],
  dark: ["#3987e5", "#d95926"],
};
const CHROME = {
  light: { grid: "#e1e0d9", tick: "#898781", surface: "#ffffff" },
  dark: { grid: "#2c2c2a", tick: "#898781", surface: "#101828" },
};

/** Acompanha o tema (classe "dark" no <html>, ver ThemeContext). */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function seriesColor(slot: 0 | 1, dark: boolean): string {
  return SERIES[dark ? "dark" : "light"][slot]!;
}

export interface Series {
  label: string;
  data: number[];
}

export function BarChart({
  labels,
  series,
  horizontal = false,
  format,
  tooltipFormat,
  height,
  label,
}: {
  labels: string[];
  series: Series[];
  horizontal?: boolean;
  /** Eixo (pode abreviar). */
  format: (v: number) => string;
  /** Dica ao passar o mouse (valor exato); padrão = format. */
  tooltipFormat?: (v: number) => string;
  height?: number;
  label: string;
}) {
  const dark = useIsDark();
  const canvas = useRef<HTMLCanvasElement>(null);
  const chrome = CHROME[dark ? "dark" : "light"];
  const h = height ?? (horizontal ? Math.max(140, labels.length * (series.length > 1 ? 44 : 32) + 40) : 260);

  useEffect(() => {
    if (!canvas.current) return;
    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels,
        datasets: series.map((s, i) => ({
          label: s.label,
          data: s.data,
          backgroundColor: seriesColor(i as 0 | 1, dark),
          // Pontas arredondadas de 4px e 2px de respiro entre barras vizinhas.
          borderRadius: 4,
          borderSkipped: "start",
          borderWidth: 2,
          borderColor: "transparent",
          maxBarThickness: 18,
          categoryPercentage: 0.7,
          barPercentage: 0.9,
        })),
      },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${(tooltipFormat ?? format)(Number(ctx.raw))}` } },
        },
        scales: {
          x: {
            grid: { display: horizontal, color: chrome.grid },
            border: { color: chrome.grid },
            ticks: { color: chrome.tick, ...(horizontal ? { precision: 0, callback: (v) => format(Number(v)) } : {}) },
          },
          y: {
            grid: { display: !horizontal, color: chrome.grid },
            border: { color: chrome.grid },
            ticks: { color: chrome.tick, ...(!horizontal ? { precision: 0, callback: (v) => format(Number(v)) } : {}) },
          },
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [JSON.stringify({ labels, series, horizontal }), dark]);

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-theme-xs text-gray-500 dark:text-gray-400">
          {series.map((s, i) => (
            <span key={s.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: seriesColor(i as 0 | 1, dark) }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ position: "relative", width: "100%", height: h }}>
        <canvas ref={canvas} role="img" aria-label={label} />
      </div>
    </div>
  );
}

/** Tabela simples (equivalente acessível de cada gráfico e relatórios em tabela). */
export function DataTable({ headers, rows, align }: { headers: string[]; rows: ReactNode[][]; align?: ("left" | "right")[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-theme-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-theme-xs uppercase tracking-wide text-gray-400 dark:border-gray-800">
            {headers.map((h, i) => (
              <th key={h} className={cn("px-2 py-2 font-semibold", (align?.[i] ?? (i ? "right" : "left")) === "right" && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
              {r.map((c, j) => (
                <td key={j} className={cn("px-2 py-2 text-gray-700 dark:text-gray-300", (align?.[j] ?? (j ? "right" : "left")) === "right" && "text-right tabular-nums")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-2 py-4 text-center text-gray-400">
                Sem dados no período.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Cartão de relatório com alternância gráfico ⇄ tabela. */
export function ReportCard({
  title,
  subtitle,
  chart,
  table,
  empty,
  className,
}: {
  title: string;
  subtitle?: string;
  chart?: ReactNode;
  table: ReactNode;
  /** Mensagem no lugar do conteúdo (ex.: falta escolher o funil). */
  empty?: string | null;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={cn("rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]", className)}>
      <div className="mb-3 flex items-start gap-3">
        <div className="flex-1">
          <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{title}</h3>
          {subtitle && <p className="text-theme-xs text-gray-500">{subtitle}</p>}
        </div>
        {chart && !empty && (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-theme-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"
          >
            {asTable ? <BarChart3 size={14} /> : <Table2 size={14} />}
            {asTable ? "Ver gráfico" : "Ver tabela"}
          </button>
        )}
      </div>
      {empty ? <p className="py-8 text-center text-theme-sm text-gray-400">{empty}</p> : chart && !asTable ? chart : table}
    </section>
  );
}
