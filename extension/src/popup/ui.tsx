// Peças visuais do popup (cartões de seção e mensagens de status).
import type { ReactNode } from "react";
import { cn } from "@tailadmin";

export function Section({ title, icon, children, aside }: { title: string; icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 flex items-center gap-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        <span className="text-brand-500">{icon}</span>
        <span className="flex-1">{title}</span>
        {aside}
      </h2>
      {children}
    </section>
  );
}

export type Status = { text: string; kind: "ok" | "err" | "info" } | null;

export function StatusText({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      className={cn(
        "mt-2 rounded-lg px-3 py-2 text-theme-xs",
        status.kind === "ok" && "bg-success-50 text-success-700",
        status.kind === "err" && "bg-error-50 text-error-700",
        status.kind === "info" && "bg-brand-50 text-brand-700",
      )}
    >
      {status.text}
    </p>
  );
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function openCrm(query = ""): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`src/dashboard/dashboard.html${query}`) });
  window.close();
}
