import type { PropsWithChildren, ReactNode } from "react";
import { Circle } from "lucide-react";
import { cn } from "../utils/cn";
import { badgePalette, type BadgeColor } from "../tokens";

export function TaPanel({
  title,
  subtitle,
  action,
  children,
  className,
}: PropsWithChildren<{ title: string; subtitle?: string; action?: ReactNode; className?: string }>) {
  return (
    <section
      className={cn(
        "mb-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-dark",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h2>
          {subtitle && <p className="mt-0.5 text-theme-xs text-gray-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface CardBreakdownItem {
  label: string;
  value: string;
  /** Cor do valor (hex) - por padrão cinza neutro. */
  color?: string;
}

export function TaCard({
  icon,
  label,
  subtitle,
  value,
  valueColor,
  accent,
  hint,
  info,
  breakdown,
}: {
  icon?: ReactNode;
  label: string;
  /** Texto curto abaixo do label - ex.: período de referência do valor. */
  subtitle?: string;
  value: string;
  valueColor?: string;
  /** Cor de destaque (borda esquerda + fundo do ícone). Sem isso, o card
   * fica neutro (comportamento anterior, sem borda colorida). */
  accent?: BadgeColor;
  hint?: string;
  info?: ReactNode;
  /** Linhas de detalhamento abaixo do valor (ex.: Recebido/A receber) - só
   * usado quando o resumo de uma linha (hint) não é suficiente. */
  breakdown?: CardBreakdownItem[];
}) {
  const accentPalette = accent ? badgePalette[accent] : null;

  return (
    <div className="relative min-w-[220px] flex-1 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-dark">
      {/* rounded-l-2xl (em vez de overflow-hidden no card inteiro) - overflow-hidden
       * cortaria o popup do InfoTooltip abaixo, que precisa extrapolar os limites do
       * card pra aparecer por cima do conteúdo vizinho. */}
      {accentPalette && <span className="absolute inset-y-0 left-0 w-1 rounded-l-2xl" style={{ background: accentPalette.fg }} aria-hidden />}
      <div className={cn("flex items-start justify-between gap-3", accentPalette && "pl-2")}>
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
              style={accentPalette ? { background: accentPalette.bg, color: accentPalette.fg } : { background: "var(--color-gray-100)", color: "var(--color-gray-500)" }}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
              {label}
              {info}
            </div>
            {subtitle && <div className="mt-0.5 text-[11px] capitalize leading-snug text-gray-400">{subtitle}</div>}
          </div>
        </div>
        <div className="shrink-0 whitespace-nowrap text-right text-lg font-bold text-gray-800 dark:text-white/90" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </div>
      </div>

      {hint && !breakdown && <div className={cn("mt-2 text-[11px] text-gray-400", accentPalette && "pl-2")}>{hint}</div>}

      {breakdown && breakdown.length > 0 && (
        <div className={cn("mt-3 space-y-1.5 border-t border-gray-100 pt-2.5 dark:border-gray-800", accentPalette && "pl-2")}>
          {breakdown.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                <Circle size={6} className="fill-current text-gray-300 dark:text-gray-600" />
                {item.label}
              </span>
              <span className="font-semibold" style={{ color: item.color ?? "var(--color-gray-500)" }}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
