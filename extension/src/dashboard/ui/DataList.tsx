// Lista padrão (contatos, organizações): busca, filtros, escolha de colunas,
// paginação, exportar Excel e importar - no padrão das tabelas da
// gestao-financeira-extensao.
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Columns3, FileDown, FileUp, Plus, Search } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import { Popover } from "./Popover";

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Começa escondida (pode ser ligada em "Colunas"). */
  hidden?: boolean;
  className?: string;
}

export const PAGE_SIZE = 25;

function useColumnPrefs(storageKey: string, columns: Column<unknown>[]): [Set<string>, (key: string) => void] {
  const [visible, setVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return new Set(JSON.parse(saved) as string[]);
    } catch {
      /* preferência opcional */
    }
    return new Set(columns.filter((c) => !c.hidden).map((c) => c.key));
  });
  const toggle = (key: string) =>
    setVisible((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        /* idem */
      }
      return next;
    });
  return [visible, toggle];
}

export function DataList<T extends { id: string }>({
  title,
  storageKey,
  columns,
  rows,
  total,
  page,
  onPage,
  search,
  onSearch,
  searchPlaceholder,
  filters,
  onNew,
  newLabel,
  onExport,
  onImport,
  onRowClick,
  empty,
}: {
  title: string;
  storageKey: string;
  columns: Column<T>[];
  rows: T[];
  total: number;
  page: number;
  onPage: (page: number) => void;
  search: string;
  onSearch: (s: string) => void;
  searchPlaceholder: string;
  filters?: ReactNode;
  onNew: () => void;
  newLabel: string;
  onExport: () => void;
  onImport: () => void;
  onRowClick: (row: T) => void;
  empty: ReactNode;
}) {
  const [visible, toggle] = useColumnPrefs(storageKey, columns as Column<unknown>[]);
  const [colsOpen, setColsOpen] = useState(false);
  const shown = columns.filter((c) => visible.has(c.key));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <div className="relative min-w-[240px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <input
            className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-theme-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
        {filters}
        <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={onNew}>
          {newLabel}
        </TaButton>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{title}</h2>
          <span className="ml-auto text-theme-xs text-gray-500">
            {from}–{to} de {total} registro(s)
          </span>
          <TaButton size="sm" disabled={page === 0} onClick={() => onPage(page - 1)} startIcon={<ChevronLeft size={14} />}>
            Anterior
          </TaButton>
          <span className="text-theme-xs text-gray-600 dark:text-gray-400">
            Página {page + 1} de {pages}
          </span>
          <TaButton size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} endIcon={<ChevronRight size={14} />}>
            Próxima
          </TaButton>
          <div className="relative">
            <TaButton size="sm" startIcon={<Columns3 size={14} />} onClick={() => setColsOpen((o) => !o)}>
              Colunas
            </TaButton>
            <Popover open={colsOpen} onClose={() => setColsOpen(false)} className="left-auto right-0 min-w-[200px] p-2">
              {columns.map((c) => (
                <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5">
                  <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} />
                  {c.label}
                </label>
              ))}
            </Popover>
          </div>
          <TaButton size="sm" startIcon={<FileUp size={14} />} onClick={onImport}>
            Importar
          </TaButton>
          <TaButton size="sm" className="!text-success-700" startIcon={<FileDown size={14} />} onClick={onExport}>
            Exportar Excel
          </TaButton>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left text-theme-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-theme-xs font-semibold text-gray-600 dark:border-gray-800 dark:bg-white/5 dark:text-gray-400">
                {shown.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2.5">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => onRowClick(r)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/5">
                  {shown.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5 text-gray-700 dark:text-gray-300", c.className)}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="py-10 text-center text-theme-sm text-gray-500">{empty}</div>}
        </div>
      </div>
    </div>
  );
}
