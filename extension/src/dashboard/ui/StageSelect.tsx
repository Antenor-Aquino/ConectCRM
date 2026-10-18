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

/** Nome da etapa em "pílula" colorida (como no HubSpot): fundo na cor da etapa e texto branco. */
export function StagePill({ name, color, vertical, className }: { name: string; color: string | null | undefined; vertical?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block max-w-full rounded-md px-2 py-0.5 text-theme-xs font-semibold leading-5 text-white",
        vertical ? "max-h-[60vh] overflow-hidden px-0.5 py-2 [writing-mode:vertical-rl]" : "truncate",
        className,
      )}
      style={{ background: stageColor(color) }}
      title={name}
    >
      {name}
    </span>
  );
}

/** Prévia, ao editar o funil, de como os nomes das etapas aparecem no quadro com a cor escolhida. */
export function StagesPreview({ stages }: { stages: { name: string; color: string | null | undefined }[] }) {
  const named = stages.filter((s) => s.name.trim());
  if (!named.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-dashed border-gray-200 p-3 dark:border-gray-700">
      <p className="mb-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Prévia no quadro</p>
      <div className="flex flex-wrap gap-1.5">
        {named.map((s, i) => (
          <StagePill key={i} name={s.name.trim()} color={s.color} />
        ))}
      </div>
    </div>
  );
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
