// Editar funil → Ficha do cartão: ordem e visibilidade dos campos da visão
// completa do cartão (coluna de dados), inclusive cada campo personalizado.
import { ArrowDown, ArrowUp, Eye, EyeOff, Heading, RotateCcw } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import type { CustomField } from "../../db/customFields";
import type { Pipeline } from "../../db/pipelines";
import { DETAIL_BLOCKS, defaultDetailLayout, type DetailItem } from "../../lib/detailLayout";

export function DetailLayoutEditor({
  pipeline,
  fields,
  items,
  onChange,
}: {
  pipeline: Pipeline;
  /** Campos personalizados que valem para este funil. */
  fields: CustomField[];
  items: DetailItem[];
  onChange: (items: DetailItem[]) => void;
}) {
  const label = (key: string) => {
    if (key.startsWith("cf:")) {
      const f = fields.find((x) => `cf:${x.id}` === key);
      return f ? f.name : "Campo removido";
    }
    return DETAIL_BLOCKS.find((b) => b.key === key)?.label ?? key;
  };
  const fieldOf = (key: string) => (key.startsWith("cf:") ? fields.find((x) => `cf:${x.id}` === key) : undefined);
  const move = (i: number, j: number) => {
    if (j < 0 || j >= items.length) return;
    const c = [...items];
    [c[i], c[j]] = [c[j]!, c[i]!];
    onChange(c);
  };
  const toggle = (i: number) => onChange(items.map((it, j) => (j === i ? { key: it.key, ...(it.hidden ? {} : { hidden: true }) } : it)));
  return (
    <div data-detail-layout-editor>
      <p className="mb-3 text-theme-xs text-gray-500">
        Ordem dos campos na visão completa dos cartões deste funil (coluna da esquerda). Use as setas para mudar a posição e o olho para mostrar ou esconder. Campos
        personalizados novos entram no fim.
      </p>
      <ul className="space-y-1">
        {items.map((it, i) => {
          const f = fieldOf(it.key);
          const section = DETAIL_BLOCKS.find((b) => b.key === it.key)?.section;
          // Campo obrigatório não pode sumir da ficha (não daria para preenchê-lo).
          const lockHidden = !!f?.required;
          return (
            <li
              key={it.key}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-theme-sm",
                it.hidden ? "border-dashed border-gray-200 text-gray-400 dark:border-gray-800" : "border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-300",
                section && !it.hidden && "bg-gray-50 dark:bg-white/5",
              )}
              data-detail-item={it.key}
            >
              {section && <Heading size={13} className="shrink-0 text-gray-400" />}
              <span className={cn("min-w-0 flex-1 truncate", section && "text-theme-xs font-semibold uppercase tracking-wide")}>{label(it.key)}</span>
              {f && <span className="shrink-0 text-theme-xs text-gray-400">campo personalizado{f.required ? " · obrigatório" : ""}</span>}
              <button type="button" title="Subir" disabled={i === 0} onClick={() => move(i, i - 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                <ArrowUp size={15} />
              </button>
              <button type="button" title="Descer" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                title={lockHidden ? "Campo obrigatório: fica sempre na ficha" : it.hidden ? "Mostrar na ficha" : "Esconder da ficha"}
                disabled={lockHidden && !it.hidden}
                onClick={() => toggle(i)}
                className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                data-detail-toggle
              >
                {it.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </li>
          );
        })}
      </ul>
      <TaButton
        size="sm"
        variant="ghost"
        className="mt-3"
        startIcon={<RotateCcw size={14} />}
        onClick={() => onChange(defaultDetailLayout(pipeline.type, fields.map((f) => f.id)))}
        data-detail-reset
      >
        Restaurar padrão
      </TaButton>
    </div>
  );
}
