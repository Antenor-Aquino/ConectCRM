// Lista de etapas com a bolinha de cor ("Etapa *" dos formulários).
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { badgePalette, cn, type BadgeColor } from "@tailadmin";
import type { Stage } from "../../db/pipelines";
import { STAGE_DOT_FALLBACK } from "../../lib/format";
import { Popover } from "./Popover";
import { inputClass } from "./form";

export function stageColor(color: string | null | undefined): string {
  return color ? (badgePalette[color as BadgeColor]?.fg ?? STAGE_DOT_FALLBACK) : STAGE_DOT_FALLBACK;
}

export function StageDot({ color }: { color: string | null | undefined }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: stageColor(color) }} />;
}

export function StageSelect({ stages, value, onChange }: { stages: Stage[]; value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = stages.find((s) => s.id === value);
  return (
    <div className="relative">
      <button type="button" className={cn(inputClass, "flex items-center gap-2 text-left")} onClick={() => setOpen((v) => !v)}>
        {current ? (
          <>
            <StageDot color={current.color} />
            <span className="flex-1 truncate">{current.name}</span>
          </>
        ) : (
          <span className="flex-1 text-gray-400">Selecione a etapa</span>
        )}
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-full py-1">
        {stages.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onChange(s.id);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5",
              s.id === value ? "font-medium text-brand-600" : "text-gray-700 dark:text-gray-300",
            )}
          >
            <StageDot color={s.color} />
            {s.name}
          </button>
        ))}
      </Popover>
    </div>
  );
}
