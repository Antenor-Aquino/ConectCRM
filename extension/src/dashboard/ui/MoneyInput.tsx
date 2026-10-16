import { useEffect, useState } from "react";
import { formatCents, parseMoneyToCents } from "../../lib/format";
import { inputClass } from "./form";

/** Valor em reais com máscara pt-BR; trabalha em centavos. */
export function MoneyInput({ value, onChange, disabled }: { value: number; onChange: (cents: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(formatCents(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatCents(value));
  }, [value, focused]);
  return (
    <input
      className={inputClass}
      inputMode="decimal"
      disabled={disabled}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        setText(value ? (value / 100).toFixed(2).replace(".", ",") : "");
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => {
        setFocused(false);
        const cents = parseMoneyToCents(text) ?? 0;
        onChange(cents);
        setText(formatCents(cents));
      }}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
