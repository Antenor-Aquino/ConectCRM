import type { ReactNode } from "react";
import { cn } from "@tailadmin";

// Field usa <div> (não <label>): vários controles são compostos (busca,
// tags, etapa) e um <label> em volta repassaria cliques para eles.

/** Título de seção em caixa-alta cinza, como nos mockups ("VALOR", "RELACIONAMENTO"). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-2 mt-5 text-theme-xs font-semibold uppercase tracking-wide text-gray-400", className)}>{children}</div>;
}

export function Field({ label, required, hint, children, className }: { label: ReactNode; required?: boolean; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 block", className)}>
      <span className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && " *"}
      </span>
      {children}
      {hint && <span className="mt-1 block text-theme-xs text-gray-500">{hint}</span>}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{children}</p>;
}

export const inputClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-theme-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";
