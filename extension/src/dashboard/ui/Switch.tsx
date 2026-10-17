// Chave liga/desliga (toggles do mockup "Criar campo personalizado").
import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@tailadmin";

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-brand-500" : "bg-gray-200 dark:bg-gray-700")}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-theme-xs transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/** Linha em caixa com ícone, rótulo, ajuda (?) e a chave. */
export function SwitchRow({
  icon,
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  help: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800">
      <span className="text-gray-600 dark:text-gray-400">{icon}</span>
      <span className="flex flex-1 items-center gap-1.5 text-theme-sm font-medium text-gray-800 dark:text-white/90">
        {label}
        <span title={help} className="cursor-help text-brand-400">
          <HelpCircle size={14} />
        </span>
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
