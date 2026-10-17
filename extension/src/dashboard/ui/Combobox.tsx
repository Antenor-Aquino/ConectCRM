// Campo de busca com lista de resultados e opção de criar novo
// (Contato: "Buscar por nome, telefone ou e-mail"; Organização; Vinculado a).
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { cn } from "@tailadmin";
import { Popover } from "./Popover";
import { inputClass } from "./form";

export interface ComboItem {
  id: string;
  label: string;
  sublabel?: string | null;
  icon?: ReactNode;
}

export function Combobox({
  value,
  onChange,
  search,
  placeholder,
  onCreate,
  createLabel = "Criar",
  dashed,
  emptyText = "Nada encontrado.",
}: {
  value: ComboItem | null;
  onChange: (item: ComboItem | null) => void;
  search: (text: string) => Promise<ComboItem[]>;
  placeholder: string;
  /** Cria um registro com o texto digitado e devolve o item criado. */
  onCreate?: (text: string) => Promise<ComboItem>;
  createLabel?: string;
  /** Visual de botão tracejado quando vazio ("Vincular ou criar organização"). */
  dashed?: ReactNode;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [items, setItems] = useState<ComboItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      void search(text).then((r) => alive && setItems(r));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, text, search]);

  const pick = (item: ComboItem | null) => {
    onChange(item);
    setOpen(false);
    setText("");
  };

  const trigger = value ? (
    <div className={cn(inputClass, "flex items-center gap-2")}>
      {value.icon}
      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setOpen(true)}>
        {value.label}
        {value.sublabel && <span className="ml-1.5 text-theme-xs text-gray-400">{value.sublabel}</span>}
      </button>
      <button type="button" title="Remover" className="text-gray-400 hover:text-gray-600" onClick={() => pick(null)}>
        <X size={14} />
      </button>
    </div>
  ) : dashed && !open ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-theme-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
    >
      {dashed}
    </button>
  ) : (
    <div className="relative">
      <input
        className={cn(inputClass, "pr-8")}
        placeholder={placeholder}
        value={text}
        autoFocus={open && !!dashed}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
      />
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-gray-400" />
    </div>
  );

  return (
    <div className="relative">
      {trigger}
      <Popover open={open} onClose={() => setOpen(false)} className="w-full py-1">
        {value && (
          <div className="px-2 pb-1 pt-1">
            <input className={inputClass} placeholder={placeholder} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        <div className="max-h-60 overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => pick(it)}
              className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {it.icon}
              <span className="truncate">{it.label}</span>
              {it.sublabel && <span className="ml-auto truncate text-theme-xs text-gray-400">{it.sublabel}</span>}
            </button>
          ))}
          {items.length === 0 && !(onCreate && text.trim()) && <p className="px-3.5 py-2 text-theme-xs text-gray-400">{emptyText}</p>}
        </div>
        {onCreate && text.trim() && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                pick(await onCreate(text.trim()));
              } finally {
                setBusy(false);
              }
            }}
            className="flex w-full items-center gap-2 border-t border-gray-100 px-3.5 py-2.5 text-left text-theme-sm font-medium text-brand-600 hover:bg-brand-50 dark:border-gray-800"
          >
            <Plus size={14} /> {createLabel} "{text.trim()}"
          </button>
        )}
      </Popover>
    </div>
  );
}
