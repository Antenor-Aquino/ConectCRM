// Botão "+" de cadastro rápido; as regras ficam em lib/quickCreate.ts.
import { useState } from "react";
import { Building2, CircleCheck, FolderKanban, Handshake, LifeBuoy, Plus, User } from "lucide-react";
import { cn } from "@tailadmin";
import type { PipelineType } from "../../db/pipelines";
import { visibleQuickCreateOptions, type QuickCreateId, type QuickCreateOption } from "../../lib/quickCreate";

const ICONS: Record<QuickCreateId, React.ReactNode> = {
  tarefa: <CircleCheck size={16} />,
  contato: <User size={16} />,
  organizacao: <Building2 size={16} />,
  negocio: <Handshake size={16} />,
  ticket: <LifeBuoy size={16} />,
  projeto: <FolderKanban size={16} />,
};

export function QuickCreateMenu({
  activeTypes,
  onSelect,
}: {
  activeTypes: PipelineType[];
  onSelect: (option: QuickCreateOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = visibleQuickCreateOptions(activeTypes);

  return (
    <div className="relative ml-1 shrink-0">
      <button
        type="button"
        title="Cadastro rápido"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-theme-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300",
          open && "border-brand-300 text-brand-600",
        )}
      >
        <Plus size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed z-20 mt-1 min-w-[200px] rounded-xl border border-gray-200 bg-white py-1 shadow-theme-md dark:border-gray-700 dark:bg-gray-900">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSelect(o);
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
              >
                <span className="text-gray-500">{ICONS[o.id]}</span>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
