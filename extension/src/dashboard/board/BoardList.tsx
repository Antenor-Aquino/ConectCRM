// Visão em lista do funil (como a do Pipedrive): uma linha por cartão, com
// colunas escolhidas pelo usuário (Personalizar colunas), ordenação pelo
// cabeçalho e total no rodapé. Usa os mesmos filtros do quadro.
import { useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowDownUp, ArrowUp, Check, Settings2, X } from "lucide-react";
import { badgePalette, cn, TaButton, type BadgeColor } from "@tailadmin";
import type { CardFieldValue } from "../../db/cardFieldValues";
import type { BoardCard, BoardColumn } from "../../db/deals";
import type { Pipeline, PipelineType } from "../../db/pipelines";
import { CARD_TEXT, OUTCOME_TEXT } from "../../lib/cardTypes";
import { formatCents } from "../../lib/format";
import { normalizeText } from "../../lib/search";
import { Popover } from "../ui/Popover";
import { StageDot } from "../ui/StageSelect";
import type { FieldOption } from "./fieldOptions";

/** Coluna própria da lista (não é campo do cartão). */
export const STAGE_COLUMN = "etapa";

export const DEFAULT_LIST_COLUMNS: Record<PipelineType, string[]> = {
  comercial: [STAGE_COLUMN, "valor", "organizacao", "contato", "responsavel", "proxima_tarefa"],
  operacional: [STAGE_COLUMN, "contato", "organizacao", "sla", "responsavel", "proxima_tarefa"],
  projeto: [STAGE_COLUMN, "contato", "inicio", "prazo", "responsavel", "proxima_tarefa"],
};

export function loadListColumns(key: string, type: PipelineType): string[] {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(list) && list.every((x) => typeof x === "string")) return list as string[];
  } catch {
    /* padrão */
  }
  return DEFAULT_LIST_COLUMNS[type];
}

type Row = BoardCard & { stage: { id: string; name: string; color: string | null; position: number } };
type SortState = { key: string; dir: 1 | -1 } | null;

const cellText = (v: CardFieldValue | undefined) => (!v ? "" : "text" in v ? v.text : v.tags.map((t) => t.name).join(", "));

export function BoardList({
  pipeline,
  columns,
  keys,
  options,
  onChangeKeys,
  onOpenCard,
  selected,
  onToggleSelect,
  onToggleMany,
}: {
  pipeline: Pipeline;
  columns: BoardColumn[];
  keys: string[];
  options: FieldOption[];
  onChangeKeys: (keys: string[]) => void;
  onOpenCard: (id: string) => void;
  /** Seleção para ações em lote. */
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleMany: (ids: string[]) => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [picker, setPicker] = useState(false);
  const text = CARD_TEXT[pipeline.type];
  const allOptions = useMemo(() => [{ key: STAGE_COLUMN, label: "Etapa", group: "Negócio" }, ...options], [options]);
  const label = (k: string) => allOptions.find((o) => o.key === k)?.label ?? "Campo removido";
  const visible = keys.filter((k) => allOptions.some((o) => o.key === k));

  const rows: Row[] = useMemo(
    () => columns.flatMap((c, position) => c.cards.map((card) => ({ ...card, stage: { id: c.id, name: c.name, color: c.color, position } }))),
    [columns],
  );
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const val = (r: Row): string | number =>
      sort.key === "titulo"
        ? normalizeText(r.title)
        : sort.key === STAGE_COLUMN
          ? r.stage.position
          : sort.key === "valor"
            ? r.value_cents
            : normalizeText(cellText(r.fields[sort.key]));
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      // Vazios sempre no fim.
      if (x === "" && y !== "") return 1;
      if (y === "" && x !== "") return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort]);

  const toggleSort = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  const total = rows.reduce((a, r) => a + r.value_cents, 0);
  const outcome = OUTCOME_TEXT[pipeline.type];

  const header = (k: string, children: React.ReactNode, className?: string) => (
    <th
      key={k}
      className={cn("whitespace-nowrap border-b border-r border-gray-200 px-3 py-2.5 text-left font-semibold last:border-r-0 dark:border-gray-800", className)}
    >
      <button type="button" className="flex items-center gap-1 hover:text-gray-800 dark:hover:text-white" onClick={() => toggleSort(k)} title="Ordenar">
        {children}
        {sort?.key === k ? sort.dir === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ArrowDownUp size={12} className="opacity-30" />}
      </button>
    </th>
  );

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col">
      <div className="mb-2 flex items-center gap-3 text-theme-xs text-gray-500">
        <span>
          {rows.length} {rows.length === 1 ? text.noun : `${text.noun}s`}
          {pipeline.type === "comercial" && ` · ${formatCents(total)}`}
        </span>
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setPicker((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <Settings2 size={15} /> Personalizar colunas
          </button>
          {picker && (
            <ColumnPicker
              keys={visible}
              options={allOptions}
              defaults={DEFAULT_LIST_COLUMNS[pipeline.type]}
              onClose={() => setPicker(false)}
              onSave={(k) => {
                onChangeKeys(k);
                setPicker(false);
              }}
            />
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-xl border border-gray-200 custom-scrollbar dark:border-gray-800">
        <table className="w-full border-separate border-spacing-0 text-theme-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 text-theme-xs text-gray-500 dark:bg-gray-800">
            <tr>
              <th className="sticky left-0 z-20 w-9 border-b border-gray-200 bg-gray-50 pl-3 dark:border-gray-800 dark:bg-gray-800">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos"
                  title="Selecionar todos"
                  checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                  ref={(el) => {
                    if (el) el.indeterminate = rows.some((r) => selected.has(r.id)) && !rows.every((r) => selected.has(r.id));
                  }}
                  onChange={() => onToggleMany(rows.map((r) => r.id))}
                  className="h-4 w-4 cursor-pointer accent-brand-500"
                />
              </th>
              {header("titulo", "Título", "sticky left-9 z-10 min-w-[220px] bg-gray-50 dark:bg-gray-800")}
              {visible.map((k) => header(k, label(k), k === "valor" ? "text-right" : undefined))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  "group cursor-pointer",
                  r.archived_at && "[&>td]:!bg-warning-50 dark:[&>td]:!bg-warning-500/10",
                  selected.has(r.id) && "[&>td]:!bg-brand-25 dark:[&>td]:!bg-brand-500/10",
                )}
                data-archived={r.archived_at ? true : undefined}
                onClick={() => (selected.size ? onToggleSelect(r.id) : onOpenCard(r.id))}
              >
                <td className="sticky left-0 w-9 border-b border-gray-100 bg-white pl-3 group-hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:group-hover:bg-gray-800">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${r.title}`}
                    checked={selected.has(r.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect(r.id)}
                    className="h-4 w-4 cursor-pointer accent-brand-500"
                  />
                </td>
                <td className="sticky left-9 max-w-[320px] border-b border-r border-gray-100 bg-white px-3 py-2 group-hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:group-hover:bg-gray-800">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "truncate font-medium",
                        r.status === "open" && "text-brand-600 dark:text-brand-400",
                        r.status === "won" && "text-success-700 dark:text-success-400",
                        r.status === "lost" && "text-error-700 dark:text-error-400",
                      )}
                      title={r.title}
                    >
                      {r.title}
                      {r.title_ext && <span className="font-normal text-gray-500" data-name-ext> - {r.title_ext}</span>}
                    </span>
                    {r.status !== "open" && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium",
                          r.status === "won" ? "bg-success-50 text-success-700" : "bg-error-50 text-error-700",
                        )}
                      >
                        {outcome[r.status]}
                      </span>
                    )}
                    {r.archived_at && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-100 px-1.5 py-px text-[10px] font-medium text-warning-800" title="Arquivado">
                        <Archive size={10} /> Arquivado
                      </span>
                    )}
                  </div>
                </td>
                {visible.map((k) => (
                  <td
                    key={k}
                    className={cn(
                      "max-w-[280px] border-b border-r border-gray-100 px-3 py-2 last:border-r-0 group-hover:bg-gray-50 dark:border-gray-800 dark:group-hover:bg-white/[0.03]",
                      k === "valor" && "text-right",
                    )}
                  >
                    <Cell k={k} row={r} />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visible.length + 2} className="px-3 py-10 text-center text-gray-400">
                  Nenhum {text.noun} com estes filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ k, row }: { k: string; row: Row }) {
  if (k === STAGE_COLUMN) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-gray-700 dark:text-gray-300">
        <StageDot color={row.stage.color} /> {row.stage.name}
      </span>
    );
  }
  const v = row.fields[k];
  if (!v) return <span className="text-gray-300 dark:text-gray-600">—</span>;
  if ("tags" in v) {
    return (
      <span className="flex flex-wrap gap-1">
        {v.tags.map((t) => {
          const c = badgePalette[(t.color as BadgeColor) ?? "slate"] ?? badgePalette.slate;
          return (
            <span
              key={t.name}
              className="rounded-full border px-1.5 py-px text-[10px] font-medium"
              style={{ background: c.bg, color: c.fg, borderColor: c.border }}
            >
              {t.name}
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <span className={cn("block truncate", v.tone === "danger" ? "text-error-600" : "text-gray-700 dark:text-gray-300")} title={v.text}>
      {v.text}
    </span>
  );
}

/** "Personalizar colunas": busca, visíveis (com ordem) e as demais por grupo. */
function ColumnPicker({
  keys,
  options,
  defaults,
  onClose,
  onSave,
}: {
  keys: string[];
  options: FieldOption[];
  defaults: string[];
  onClose: () => void;
  onSave: (keys: string[]) => void;
}) {
  const [draft, setDraft] = useState(keys);
  const [q, setQ] = useState("");
  const match = (o: FieldOption) => !q.trim() || normalizeText(`${o.label} ${o.group}`).includes(normalizeText(q));
  const byKey = (k: string) => options.find((o) => o.key === k);
  const hidden = options.filter((o) => !draft.includes(o.key) && match(o));
  const groups = [...new Set(hidden.map((o) => o.group))];
  const move = (i: number, j: number) => {
    if (j < 0 || j >= draft.length) return;
    const c = [...draft];
    [c[i], c[j]] = [c[j]!, c[i]!];
    setDraft(c);
  };
  return (
    <Popover open onClose={onClose} className="left-auto right-0 flex max-h-[70vh] w-80 flex-col">
      <div className="border-b border-gray-100 p-3 dark:border-gray-800">
        <p className="mb-2 text-theme-sm font-semibold text-gray-800 dark:text-white/90">Personalizar colunas</p>
        <input
          autoFocus
          className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-theme-sm focus:border-brand-300 focus:outline-none dark:border-gray-700 dark:bg-gray-900"
          placeholder="Pesquisar campo…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <p className="bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase text-gray-500 dark:bg-white/5">Visíveis ({draft.length + 1})</p>
        <ul>
          <li className="flex items-center gap-2 px-3 py-1.5 text-theme-sm text-gray-400">
            <Check size={14} /> Título <span className="ml-auto text-[11px]">sempre</span>
          </li>
          {draft.map((k, i) => {
            const o = byKey(k);
            if (!o || !match(o)) return null;
            return (
              <li key={k} className="flex items-center gap-2 px-3 py-1.5 text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5">
                <input type="checkbox" checked onChange={() => setDraft(draft.filter((x) => x !== k))} />
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-white/90">{o.label}</span>
                <button
                  type="button"
                  title="Mover para a esquerda"
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  title="Mover para a direita"
                  disabled={i === draft.length - 1}
                  onClick={() => move(i, i + 1)}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                >
                  <ArrowDown size={13} />
                </button>
              </li>
            );
          })}
        </ul>
        {groups.map((g) => (
          <div key={g}>
            <p className="bg-gray-50 px-3 py-1.5 text-[11px] font-semibold uppercase text-gray-500 dark:bg-white/5">{g}</p>
            <ul>
              {hidden
                .filter((o) => o.group === g)
                .map((o) => (
                  <li key={o.key}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5">
                      <input type="checkbox" checked={false} onChange={() => setDraft([...draft, o.key])} />
                      {o.label}
                    </label>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-gray-100 p-3 dark:border-gray-800">
        <button type="button" className="text-theme-sm font-medium text-gray-600 hover:underline" onClick={() => setDraft(defaults)}>
          Colunas padrão
        </button>
        <TaButton size="sm" variant="outline" className="ml-auto" startIcon={<X size={13} />} onClick={onClose}>
          Cancelar
        </TaButton>
        <TaButton size="sm" variant="primary" onClick={() => onSave(draft)}>
          Salvar
        </TaButton>
      </div>
    </Popover>
  );
}
