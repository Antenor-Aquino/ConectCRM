// Telefone com seletor de país (bandeira), padrão Brasil +55 (specs 03 e 04).
import { cn } from "@tailadmin";
import { inputClass } from "./form";

export const COUNTRIES = [
  { code: "BR", flag: "🇧🇷", dial: "+55" },
  { code: "PT", flag: "🇵🇹", dial: "+351" },
  { code: "US", flag: "🇺🇸", dial: "+1" },
  { code: "AR", flag: "🇦🇷", dial: "+54" },
  { code: "PY", flag: "🇵🇾", dial: "+595" },
  { code: "UY", flag: "🇺🇾", dial: "+598" },
  { code: "CL", flag: "🇨🇱", dial: "+56" },
  { code: "ES", flag: "🇪🇸", dial: "+34" },
];

/** "+5511999998888" → "(11) 99999-8888" quando for Brasil; senão devolve como está. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Valor sem o código do país, para editar. */
export function localPart(e164: string | null | undefined, country = "BR"): string {
  if (!e164) return "";
  if (country === "BR" && e164.startsWith("+55")) return formatPhone(e164);
  const dial = COUNTRIES.find((c) => c.code === country)?.dial ?? "";
  return dial && e164.startsWith(dial) ? e164.slice(dial.length) : e164;
}

export function PhoneInput({
  value,
  country,
  onChange,
  placeholder,
}: {
  value: string;
  country: string;
  onChange: (value: string, country: string) => void;
  placeholder?: string;
}) {
  const current = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0]!;
  return (
    <div className={cn(inputClass, "flex items-center gap-2 px-2 py-0 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-500/10")}>
      <select
        className="h-full cursor-pointer border-none bg-transparent pr-1 text-theme-sm outline-none"
        value={current.code}
        onChange={(e) => onChange(value, e.target.value)}
        title="País"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.dial}
          </option>
        ))}
      </select>
      <input
        className="h-full min-w-0 flex-1 border-none bg-transparent text-theme-sm outline-none"
        inputMode="tel"
        placeholder={placeholder ?? (current.code === "BR" ? "(11) 99999-8888" : "")}
        value={value}
        onChange={(e) => onChange(e.target.value, current.code)}
      />
    </div>
  );
}
