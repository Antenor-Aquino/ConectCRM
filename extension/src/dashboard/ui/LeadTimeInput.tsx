// Antecedência livre: número + unidade (min, horas, dias) "antes".
// Ex.: 1 min, 7 min, 45 min, 2 horas, 3 dias. O valor é sempre em minutos.
import { useRef, useState } from "react";

const UNITS = [
  { id: "min", label: "min", factor: 1 },
  { id: "h", label: "horas", factor: 60 },
  { id: "d", label: "dias", factor: 1440 },
] as const;
type UnitId = (typeof UNITS)[number]["id"];

/** Unidade para mostrar um valor salvo: 1440 → 1 dia, 120 → 2 horas, 45 → 45 min. */
export function leadUnitOf(min: number): UnitId {
  return ([...UNITS].reverse().find((u) => min > 0 && min % u.factor === 0) ?? UNITS[0]).id;
}

/** Limite do envio (30 dias). */
export const LEAD_MAX_MIN = 60 * 24 * 30;

export function LeadTimeInput({
  value,
  onChange,
  disabled,
  label = "Antecedência",
}: {
  value: number;
  onChange: (min: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  // A unidade escolhida fica até o usuário trocar (digitar 60 min não vira "1 hora").
  const [unit, setUnit] = useState<UnitId>(() => leadUnitOf(value));
  const [text, setText] = useState(() => String(value / UNITS.find((u) => u.id === leadUnitOf(value))!.factor));
  // Valor trocado de fora (ex.: padrão das Configurações chegou depois): unidade "redonda" de novo.
  const last = useRef(value);
  if (last.current !== value) {
    last.current = value;
    const f = UNITS.find((u) => u.id === unit)!.factor;
    if (Number(text) * f !== value) {
      const u = leadUnitOf(value);
      setUnit(u);
      setText(String(value / UNITS.find((x) => x.id === u)!.factor));
    }
  }
  const factor = UNITS.find((u) => u.id === unit)!.factor;
  const shown = Number(text) * factor === value ? text : String(Math.round((value / factor) * 100) / 100);
  const emit = (n: number, f: number) => {
    const v = Math.min(LEAD_MAX_MIN, Math.max(0, Math.round(n * f)));
    last.current = v;
    onChange(v);
  };
  const cls = "h-9 rounded-lg border border-gray-300 bg-white text-theme-sm dark:border-gray-700 dark:bg-gray-900";
  return (
    <div className="mt-1 flex items-center gap-1" data-lead-time>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        className={`${cls} w-16 px-2`}
        value={shown}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          setText(e.target.value);
          emit(Number(e.target.value) || 0, factor);
        }}
      />
      <select
        className={`${cls} min-w-0 flex-1 px-1.5`}
        value={unit}
        disabled={disabled}
        aria-label={`${label}: unidade`}
        onChange={(e) => {
          const u = UNITS.find((x) => x.id === e.target.value)!;
          setUnit(u.id);
          emit(Number(shown) || 0, u.factor);
        }}
      >
        {UNITS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label} antes
          </option>
        ))}
      </select>
    </div>
  );
}
