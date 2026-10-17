// "Quando" da tarefa (mockup): texto por extenso ("16 de outubro às 18:25") e
// painel com calendário (Out 2026 ‹ ›), Hora, Duração e Lembrete em minutos.
import { useState } from "react";
import { ChevronLeft, ChevronRight, HelpCircle, X } from "lucide-react";
import { cn } from "@tailadmin";
import { Popover } from "../ui/Popover";
import { inputClass } from "../ui/form";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "16 de outubro às 18:25" (com o ano quando não for o atual). */
export function whenLabel(d: Date): string {
  const year = d.getFullYear() !== new Date().getFullYear() ? ` de ${d.getFullYear()}` : "";
  return `${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}${year} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WhenPicker({
  value,
  duration = 0,
  reminder = null,
  simple,
  onChange,
}: {
  value: Date;
  duration?: number;
  reminder?: number | null;
  /** Só data e hora (sem duração e lembrete), ex.: finalização. */
  simple?: boolean;
  onChange: (v: { when: Date; duration: number; reminder: number | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(new Date(value.getFullYear(), value.getMonth(), 1));
  const start = new Date(view.getFullYear(), view.getMonth(), 1 - view.getDay());
  const days = Array.from({ length: 35 + (view.getDay() + new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate() > 35 ? 7 : 0) }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const today = new Date();
  const set = (patch: Partial<{ when: Date; duration: number; reminder: number | null }>) => onChange({ when: value, duration, reminder, ...patch });

  return (
    <div className="relative">
      <button
        type="button"
        className={cn(inputClass, "text-left")}
        onClick={() => {
          setView(new Date(value.getFullYear(), value.getMonth(), 1));
          setOpen((o) => !o);
        }}
      >
        {whenLabel(value)}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-[300px] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </span>
          <span className="flex gap-1">
            <button type="button" title="Mês anterior" className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
              <ChevronLeft size={15} />
            </button>
            <button type="button" title="Próximo mês" className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
              <ChevronRight size={15} />
            </button>
          </span>
        </div>
        <div className="grid grid-cols-7 text-center text-theme-xs text-gray-400">
          {WEEKDAYS.map((w) => (
            <span key={w} className="py-1">
              {w}
            </span>
          ))}
          {days.map((d) => {
            const sel = sameDay(d, value);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => set({ when: new Date(d.getFullYear(), d.getMonth(), d.getDate(), value.getHours(), value.getMinutes()) })}
                className={cn(
                  "mx-auto my-0.5 flex h-8 w-8 items-center justify-center rounded-full text-theme-sm",
                  d.getMonth() !== view.getMonth() ? "text-gray-300 dark:text-gray-600" : "text-gray-700 dark:text-gray-300",
                  sel ? "bg-brand-500 font-semibold text-white" : sameDay(d, today) ? "ring-1 ring-brand-300" : "hover:bg-gray-100 dark:hover:bg-white/5",
                )}
              >
                {pad(d.getDate())}
              </button>
            );
          })}
        </div>
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
          <label className="flex items-center justify-between gap-3 text-theme-sm text-gray-700 dark:text-gray-300">
            Hora:
            <input
              type="time"
              className={cn(inputClass, "w-36")}
              value={`${pad(value.getHours())}:${pad(value.getMinutes())}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                if (h !== undefined && m !== undefined && !Number.isNaN(h)) set({ when: new Date(value.getFullYear(), value.getMonth(), value.getDate(), h, m) });
              }}
            />
          </label>
          {!simple && (
          <>
          <label className="flex items-center justify-between gap-3 text-theme-sm text-gray-700 dark:text-gray-300">
            Duração:
            <span className="relative w-36">
              <input type="number" min={0} className={cn(inputClass, "pr-10")} value={duration} onChange={(e) => set({ duration: Math.max(0, Number(e.target.value) || 0) })} />
              <span className="pointer-events-none absolute right-3 top-2.5 text-theme-xs text-gray-400">min</span>
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 text-theme-sm text-gray-700 dark:text-gray-300">
            <span className="flex items-center gap-1">
              Lembrete
              <span title="Minutos antes da tarefa para o Chrome avisar. Deixe vazio para não lembrar." className="cursor-help text-gray-400">
                <HelpCircle size={13} />
              </span>
              :
            </span>
            <span className="relative w-36">
              <input
                type="number"
                min={0}
                placeholder="sem"
                className={cn(inputClass, "pr-10")}
                value={reminder ?? ""}
                onChange={(e) => set({ reminder: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
              />
              <span className="pointer-events-none absolute right-3 top-2.5 text-theme-xs text-gray-400">min</span>
            </span>
          </label>
          </>
          )}
        </div>
      </Popover>
    </div>
  );
}

/** Finalização (prazo de entrega) opcional: vazio = sem prazo. */
export function EndPicker({ value, start, onChange }: { value: Date | null; start: Date; onChange: (d: Date | null) => void }) {
  if (!value) {
    return (
      <button
        type="button"
        className={cn(inputClass, "text-left text-gray-400")}
        onClick={() => {
          // Sugestão: o dia seguinte ao início, às 18h.
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 18, 0);
          onChange(d);
        }}
      >
        Sem finalização (opcional)
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <WhenPicker value={value} simple onChange={(v) => onChange(v.when)} />
      </div>
      <button type="button" title="Remover a finalização" onClick={() => onChange(null)} className="text-gray-400 hover:text-error-600">
        <X size={16} />
      </button>
    </div>
  );
}
