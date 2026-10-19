// Lista de lembretes (spec 10): cada linha é "N min/h/dias antes" com os
// canais que avisam (Chrome, e-mail, WhatsApp). Usada na atividade e nos
// lembretes padrão das Configurações → Notificações.
import { Bell, Mail, MessageCircle, Plus, X } from "lucide-react";
import { cn } from "@tailadmin";
import { CHANNEL_LABEL, CHANNELS, type Channel, type ReminderRule } from "../../lib/notify/settings";
import { inputClass } from "./form";

const UNITS = [
  { id: "min", label: "min", factor: 1 },
  { id: "h", label: "horas", factor: 60 },
  { id: "d", label: "dias", factor: 1440 },
] as const;

const CHANNEL_ICON: Record<Channel, React.ReactNode> = {
  chrome: <Bell size={12} />,
  email: <Mail size={12} />,
  whatsapp: <MessageCircle size={12} />,
};

/** Unidade "redonda" para mostrar: 1440 → 1 dia, 120 → 2 h, 45 → 45 min. */
function split(min: number): { n: number; unit: (typeof UNITS)[number] } {
  const unit = [...UNITS].reverse().find((u) => min > 0 && min % u.factor === 0) ?? UNITS[0];
  return { n: min / unit.factor, unit };
}

export function RemindersEditor({
  value,
  onChange,
  ready,
  compact,
}: {
  value: ReminderRule[];
  onChange: (v: ReminderRule[]) => void;
  /** Canais configurados (os outros aparecem com aviso). */
  ready?: Partial<Record<Channel, boolean>>;
  /** Canais só com o ícone (janelas estreitas). */
  compact?: boolean;
}) {
  const set = (i: number, patch: Partial<ReminderRule>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2" data-reminders>
      {value.length === 0 && <p className="text-theme-xs text-gray-400">Sem lembretes.</p>}
      {value.map((r, i) => {
        const { n, unit } = split(r.minutesBefore);
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5" data-reminder-row>
            <input
              type="number"
              min={0}
              aria-label="Antecedência"
              className={cn(inputClass, "h-8 w-16 px-2")}
              value={n}
              onChange={(e) => set(i, { minutesBefore: Math.max(0, Math.round(Number(e.target.value) || 0)) * unit.factor })}
            />
            <select
              aria-label="Unidade"
              className="h-8 rounded-lg border border-gray-300 bg-white px-1.5 text-theme-xs dark:border-gray-700 dark:bg-gray-900"
              value={unit.id}
              onChange={(e) => set(i, { minutesBefore: n * (UNITS.find((u) => u.id === e.target.value)?.factor ?? 1) })}
            >
              {UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
            <span className="text-theme-xs text-gray-500">antes</span>
            {CHANNELS.map((c) => {
              const on = r.channels.includes(c);
              const warn = on && ready && ready[c] === false;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  aria-label={CHANNEL_LABEL[c]}
                  title={warn ? `${CHANNEL_LABEL[c]} não está configurado em Configurações → Notificações` : CHANNEL_LABEL[c]}
                  onClick={() => set(i, { channels: on ? r.channels.filter((x) => x !== c) : [...r.channels, c] })}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-full border text-theme-xs",
                    compact ? "w-7 justify-center" : "px-2",
                    on
                      ? warn
                        ? "border-warning-300 bg-warning-50 text-warning-700"
                        : "border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-500/15"
                      : "border-gray-200 text-gray-400 hover:border-gray-300 dark:border-gray-700",
                  )}
                >
                  {CHANNEL_ICON[c]}
                  {!compact && CHANNEL_LABEL[c]}
                </button>
              );
            })}
            <button
              type="button"
              title="Remover lembrete"
              className="ml-auto text-gray-400 hover:text-error-600"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="flex items-center gap-1 text-theme-xs font-medium text-brand-600 hover:underline"
        onClick={() => onChange([...value, { minutesBefore: value.length ? 60 : 15, channels: value[value.length - 1]?.channels ?? ["chrome"] }])}
      >
        <Plus size={13} /> Adicionar lembrete
      </button>
    </div>
  );
}
