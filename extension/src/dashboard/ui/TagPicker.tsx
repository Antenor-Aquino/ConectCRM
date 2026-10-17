// Seleção múltipla de tags da entidade, em "chips" coloridos, com criação rápida.
import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { badgePalette, cn, type BadgeColor } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Tag, TagEntity } from "../../db/tags";
import { Popover } from "./Popover";
import { inputClass } from "./form";
import { errorText } from "../../lib/errors";

export function TagChip({ tag, onRemove }: { tag: Pick<Tag, "name" | "color">; onRemove?: () => void }) {
  const c = badgePalette[(tag.color as BadgeColor) ?? "slate"] ?? badgePalette.slate;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-theme-xs font-medium" style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>
      {tag.name}
      {onRemove && (
        <button type="button" onClick={onRemove} className="opacity-70 hover:opacity-100">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

export function TagPicker({ entity, value, onChange }: { entity: TagEntity; value: string[]; onChange: (ids: string[]) => void }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => call("tags.list", { entity }).then(setTags), [entity]);
  useEffect(() => {
    void load();
  }, [load]);

  const selected = tags.filter((t) => value.includes(t.id));
  const available = tags.filter((t) => !value.includes(t.id) && t.name.toLowerCase().includes(text.trim().toLowerCase()));
  const exact = tags.some((t) => t.name.toLowerCase() === text.trim().toLowerCase());

  return (
    <div className="relative">
      <div className={cn(inputClass, "flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5")} onClick={() => setOpen(true)}>
        {selected.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => onChange(value.filter((id) => id !== t.id))} />
        ))}
        <input
          className="min-w-[80px] flex-1 border-none bg-transparent p-0 text-theme-sm outline-none focus:ring-0"
          value={text}
          placeholder={selected.length ? "" : "Adicionar tags"}
          onFocus={() => setOpen(true)}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <Popover open={open} onClose={() => setOpen(false)} className="w-full py-1">
        <div className="max-h-52 overflow-y-auto">
          {available.map((t) => (
            <button
              key={t.id}
              type="button"
              className="flex w-full px-3.5 py-2 hover:bg-gray-50 dark:hover:bg-white/5"
              onClick={() => {
                onChange([...value, t.id]);
                setText("");
              }}
            >
              <TagChip tag={t} />
            </button>
          ))}
          {available.length === 0 && !text.trim() && (
            <p className="px-3.5 py-2 text-theme-xs text-gray-400">{tags.length ? "Todas as tags já foram adicionadas." : "Nenhuma tag cadastrada. Digite para criar."}</p>
          )}
        </div>
        {text.trim() && !exact && (
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t border-gray-100 px-3.5 py-2.5 text-theme-sm font-medium text-brand-600 hover:bg-brand-50 dark:border-gray-800"
            onClick={async () => {
              try {
                const id = await call("tags.create", { entity, name: text.trim() });
                await load();
                onChange([...value, id]);
                setText("");
                setError(null);
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            <Plus size={14} /> Criar tag "{text.trim()}"
          </button>
        )}
        {error && <p className="px-3.5 py-2 text-theme-xs text-error-600">{error}</p>}
      </Popover>
    </div>
  );
}
