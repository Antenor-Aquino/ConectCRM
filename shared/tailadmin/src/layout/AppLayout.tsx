import type { ReactNode } from "react";

export function AppLayout({
  header,
  children,
  demoMode = false,
}: {
  header: ReactNode;
  children: ReactNode;
  demoMode?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
      {demoMode && (
        <div className="bg-warning-500 px-4 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-white">
          Ambiente de teste — dados fictícios
        </div>
      )}
      {header}
      <main className="flex-1 p-4 md:p-6 2xl:p-8">
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
