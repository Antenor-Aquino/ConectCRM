// Editar funil → Cartão: escolha e ordem dos campos exibidos nos cartões
// deste funil (do negócio, do contato, da organização e personalizados),
// com prévia ao vivo no cartão mais recente do funil.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import { TaButton, TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CardFieldValue } from "../../db/cardFieldValues";
import type { Pipeline } from "../../db/pipelines";
import { DEFAULT_CARD_FIELDS, MAX_CARD_FIELDS } from "../../lib/cardFields";
import { useCardFieldOptions } from "./fieldOptions";
import { CardFields } from "./KanbanCard";

export function CardLayoutEditor({ pipeline, keys, onChange }: { pipeline: Pipeline; keys: string[]; onChange: (keys: string[]) => void }) {
  const [preview, setPreview] = useState<{ title: string; fields: Record<string, CardFieldValue> } | null | undefined>(undefined);
  const options = useCardFieldOptions(pipeline);

  useEffect(() => {
    void call("cards.previewFields", { pipelineId: pipeline.id, keys }).then(setPreview);
  }, [pipeline, keys]);

  const label = (k: string) => {
    const o = options.find((x) => x.key === k);
    return o ? `${o.label}` : "Campo removido";
  };
  const groupOf = (k: string) => options.find((x) => x.key === k)?.group ?? "";
  const available = options.filter((o) => !keys.includes(o.key));
  const groups = [...new Set(available.map((o) => o.group))];
  const move = (i: number, j: number) => {
    if (j < 0 || j >= keys.length) return;
    const c = [...keys];
    [c[i], c[j]] = [c[j]!, c[i]!];
    onChange(c);
  };
  const sample: Record<string, CardFieldValue> = Object.fromEntries(keys.map((k) => [k, k === "tags" ? { tags: [{ name: "Exemplo", color: "blue" }] } : { text: label(k), label: k.includes(":") ? label(k) : undefined }]));

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_260px]">
      <div>
        <p className="mb-3 text-theme-xs text-gray-500">
          O título aparece sempre. O valor fica no topo e o responsável no rodapé; os demais seguem a ordem abaixo. Campos sem valor não aparecem no cartão.
        </p>
        <ol className="space-y-1.5">
          {keys.map((k, i) => (
            <li key={k} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
              <span className="w-5 text-theme-xs text-gray-400">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-theme-sm text-gray-800 dark:text-white/90">{label(k)}</span>
                <span className="block text-[11px] text-gray-400">{groupOf(k)}</span>
              </span>
              <button type="button" title="Subir" disabled={i === 0} onClick={() => move(i, i - 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                <ArrowUp size={14} />
              </button>
              <button type="button" title="Descer" disabled={i === keys.length - 1} onClick={() => move(i, i + 1)} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                <ArrowDown size={14} />
              </button>
              <button type="button" title="Remover do cartão" onClick={() => onChange(keys.filter((x) => x !== k))} className="text-gray-400 hover:text-error-600">
                <X size={14} />
              </button>
            </li>
          ))}
          {keys.length === 0 && <li className="rounded-lg border border-dashed border-gray-300 px-3 py-3 text-theme-sm text-gray-400">Só o título será exibido.</li>}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TaSelect
            className="w-64"
            value=""
            disabled={keys.length >= MAX_CARD_FIELDS || available.length === 0}
            onChange={(e) => e.target.value && onChange([...keys, e.target.value])}
          >
            <option value="">{keys.length >= MAX_CARD_FIELDS ? `Máximo de ${MAX_CARD_FIELDS} campos` : "+ Adicionar campo…"}</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {available
                  .filter((o) => o.group === g)
                  .map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </TaSelect>
          <TaButton size="sm" variant="ghost" startIcon={<RotateCcw size={14} />} onClick={() => onChange(DEFAULT_CARD_FIELDS[pipeline.type])}>
            Restaurar padrão
          </TaButton>
        </div>
      </div>
      <div>
        <p className="mb-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Prévia</p>
        <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <CardFields title={preview?.title ?? "Nome do cartão"} keys={keys} fields={preview ? preview.fields : sample} />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">{preview ? "Com os dados do cartão mais recente deste funil." : "Exemplo (o funil ainda não tem cartões)."}</p>
      </div>
    </div>
  );
}
