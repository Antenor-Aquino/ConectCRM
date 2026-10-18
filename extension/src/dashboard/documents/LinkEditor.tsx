// Vínculos de um documento: etiquetas removíveis + busca para acrescentar
// cartão, tarefa, contato ou organização.
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { call } from "../../rpc/client";
import type { DocLink } from "../../db/documents";
import { Popover } from "../ui/Popover";
import { inputClass } from "../ui/form";
import { LINK_TYPE_LABEL, LinkChip, LinkIcon } from "./docUi";

export function LinkEditor({ value, onChange }: { value: DocLink[]; onChange: (links: DocLink[]) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DocLink[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const t = setTimeout(() => void call("documents.linkTargets", { q }).then(setResults), 200);
    return () => clearTimeout(t);
  }, [q]);

  const has = (l: DocLink) => value.some((v) => v.type === l.type && v.id === l.id);
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((l) => (
          <LinkChip key={`${l.type}:${l.id}`} link={l} onRemove={() => onChange(value.filter((v) => !(v.type === l.type && v.id === l.id)))} />
        ))}
        {value.length === 0 && <span className="text-theme-xs text-gray-400">Sem vínculo: o documento fica só no GED.</span>}
      </div>
      <div className="relative mt-2">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className={`${inputClass} pl-8`}
          placeholder="Vincular também a… (cartão, atividade, contato ou organização)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <Popover open={open && results.length > 0} onClose={() => setOpen(false)} className="max-h-72 w-full overflow-y-auto p-1">
          {results.map((r) => (
            <button
              key={`${r.type}:${r.id}`}
              type="button"
              disabled={has(r)}
              onClick={() => {
                onChange([...value, { ...r, auto: false }]);
                setQ("");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-theme-sm hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-white/5"
            >
              <span className="text-gray-400">
                <LinkIcon type={r.type} size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-white/90">{r.label}</span>
              <span className="shrink-0 text-theme-xs text-gray-400">{r.sub ? `${LINK_TYPE_LABEL[r.type]} · ${r.sub}` : LINK_TYPE_LABEL[r.type]}</span>
            </button>
          ))}
        </Popover>
      </div>
    </div>
  );
}
