// Seletor de SLA (spec 01, seção 6): calendário « ‹ Ano Mês › », colunas de
// hora (00–23) e minuto (00–59), botões Agora e OK.
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@tailadmin";
import { formatDateTime } from "../../lib/format";
import { Popover } from "./Popover";
import { inputClass } from "./form";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Interpreta "dd/mm/aaaa hh:mm" digitado no campo. */
function parseTyped(text: string): Date | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function SlaPicker({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | null>(value ? new Date(value) : null);
  const [view, setView] = useState(() => {
    const d = value ? new Date(value) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [text, setText] = useState(formatDateTime(value));
  const hoursRef = useRef<HTMLDivElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);

  useEffect(() => setText(formatDateTime(value)), [value]);

  useEffect(() => {
    if (!open || !draft) return;
    hoursRef.current?.querySelector(`[data-v="${draft.getHours()}"]`)?.scrollIntoView({ block: "center" });
    minutesRef.current?.querySelector(`[data-v="${draft.getMinutes()}"]`)?.scrollIntoView({ block: "center" });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const openPicker = () => {
    const d = value ? new Date(value) : null;
    setDraft(d);
    if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setOpen(true);
  };

  const shift = (months: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + months, 1));
  const start = new Date(view.getFullYear(), view.getMonth(), 1 - view.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const today = new Date();

  const setDay = (d: Date) => setDraft((cur) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), cur?.getHours() ?? 0, cur?.getMinutes() ?? 0));
  const setTime = (h: number | null, m: number | null) =>
    setDraft((cur) => {
      const base = cur ?? new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h ?? base.getHours(), m ?? base.getMinutes());
    });

  const column = (count: number, current: number | undefined, onPick: (n: number) => void, ref: React.RefObject<HTMLDivElement | null>) => (
    <div ref={ref} className="h-[252px] w-12 overflow-y-auto border-l border-gray-100 py-1 no-scrollbar dark:border-gray-800">
      {Array.from({ length: count }, (_, n) => (
        <button
          key={n}
          type="button"
          data-v={n}
          onClick={() => onPick(n)}
          className={cn(
            "block w-full py-1 text-center text-theme-sm",
            current === n ? "rounded bg-brand-50 font-semibold text-brand-600" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300",
          )}
        >
          {String(n).padStart(2, "0")}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative">
      <div className="relative">
        <input
          className={cn(inputClass, "pr-9")}
          value={text}
          placeholder="dd/mm/aaaa hh:mm"
          onFocus={openPicker}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (!text.trim()) onChange(null);
            else {
              const d = parseTyped(text);
              if (d) onChange(d.toISOString());
              else setText(formatDateTime(value));
            }
          }}
        />
        <CalendarDays size={16} className="pointer-events-none absolute right-3 top-3 text-gray-400" />
      </div>
      <Popover open={open} onClose={() => setOpen(false)} className="w-auto">
        <div className="flex">
          <div className="w-[280px] p-3">
            <div className="mb-2 flex items-center justify-between text-gray-500">
              <div className="flex gap-1">
                <button type="button" title="Ano anterior" onClick={() => shift(-12)}><ChevronsLeft size={16} /></button>
                <button type="button" title="Mês anterior" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
              </div>
              <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                {view.getFullYear()} {MONTHS[view.getMonth()]}
              </span>
              <div className="flex gap-1">
                <button type="button" title="Próximo mês" onClick={() => shift(1)}><ChevronRight size={16} /></button>
                <button type="button" title="Próximo ano" onClick={() => shift(12)}><ChevronsRight size={16} /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-theme-xs text-gray-500">
              {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
              {days.map((d) => {
                const outside = d.getMonth() !== view.getMonth();
                const selected = draft && sameDay(d, draft);
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => setDay(d)}
                    className={cn(
                      "m-0.5 rounded-md py-1 text-theme-sm",
                      outside ? "text-gray-300 dark:text-gray-600" : "text-gray-700 dark:text-gray-300",
                      sameDay(d, today) && "ring-1 ring-brand-300",
                      selected ? "bg-brand-500 text-white" : "hover:bg-gray-100 dark:hover:bg-white/5",
                    )}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
          {column(24, draft?.getHours(), (h) => setTime(h, null), hoursRef)}
          {column(60, draft?.getMinutes(), (m) => setTime(null, m), minutesRef)}
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 dark:border-gray-800">
          <button type="button" className="text-theme-sm text-brand-600 hover:underline" onClick={() => setDraft(new Date())}>
            Agora
          </button>
          <button
            type="button"
            disabled={!draft}
            onClick={() => {
              onChange(draft ? draft.toISOString() : null);
              setOpen(false);
            }}
            className="rounded-md bg-brand-500 px-3 py-1 text-theme-xs font-medium text-white disabled:bg-gray-200 disabled:text-gray-400"
          >
            OK
          </button>
        </div>
      </Popover>
    </div>
  );
}
