// Quadro Kanban do funil (tela inicial do mockup): busca, filtros, visões
// Fluxo geral / Meu fluxo / Minha equipe, ordenação, colunas com quantidade
// e soma, "+" tracejado por coluna e arrastar cartões entre etapas.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  Clock,
  Columns3,
  Filter,
  FoldHorizontal,
  List,
  MoreHorizontal,
  MoreVertical,
  PanelLeft,
  Plus,
  Search,
  UnfoldHorizontal,
} from "lucide-react";
import { TaBadge, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { BoardColumn, BoardSort, BoardView, DealStatus } from "../../db/deals";
import type { DealKind, Pipeline, PipelineType } from "../../db/pipelines";
import type { Tag } from "../../db/tags";
import { CARD_TEXT, OUTCOME_TEXT, PIPELINE_TYPE_LABEL } from "../../lib/cardTypes";
import { formatCents } from "../../lib/format";
import { useSession } from "../session";
import { Popover } from "../ui/Popover";
import { StagePill } from "../ui/StageSelect";
import { TagChip } from "../ui/TagPicker";
import { BoardList, loadListColumns, STAGE_COLUMN } from "./BoardList";
import { useCardFieldOptions } from "./fieldOptions";
import { KanbanCard } from "./KanbanCard";
import { errorText } from "../../lib/errors";
import { TaskModal, type TaskRequest } from "../tasks/TaskModal";
import { CardImportModal } from "./CardImportModal";

const VIEW_LABEL: Record<BoardView, string> = { all: "Fluxo geral", mine: "Meu fluxo", team: "Minha equipe" };
const SORT_LABEL: Record<BoardSort, string> = {
  recent: "Mais recentes",
  updated: "Atualizados recentemente",
  manual: "Ordem manual",
  value: "Maior valor",
  title: "Nome (A–Z)",
};
const STATUS_LABEL: Record<DealStatus | "all", string> = { open: "Abertos", won: "Ganhos", lost: "Perdidos", all: "Todos" };
/** Status do filtro com os termos do tipo de funil (Ganhos / Resolvidos / Concluídos...). */
const statusLabels = (type: PipelineType): Record<DealStatus | "all", string> => ({
  ...STATUS_LABEL,
  won: OUTCOME_TEXT[type].wonPlural,
  lost: OUTCOME_TEXT[type].lostPlural,
});
const TYPE_BADGE = { comercial: "blue", operacional: "purple", projeto: "cyan" } as const;

/**
 * Filtro do quadro, o mesmo em todos os funis de todas as categorias: situação
 * e responsáveis valem para todos; as tags são de cada tipo de cartão
 * (negócio, ticket, etapa), então ficam guardadas por tipo.
 */
interface BoardFilter {
  status: DealStatus | "all";
  ownerIds: string[];
  tagIdsByKind: Partial<Record<DealKind, string[]>>;
}
const EMPTY_FILTER: BoardFilter = { status: "open", ownerIds: [], tagIdsByKind: {} };

function loadFilter(key: string, legacyKey: string, kind: DealKind): BoardFilter {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const f = JSON.parse(raw) as Partial<BoardFilter>;
      return {
        status: f.status && f.status in STATUS_LABEL ? f.status : "open",
        ownerIds: Array.isArray(f.ownerIds) ? f.ownerIds : [],
        tagIdsByKind: f.tagIdsByKind && typeof f.tagIdsByKind === "object" ? f.tagIdsByKind : {},
      };
    }
    // Até 0.2.27 o filtro era por funil: o do funil aberto vira o filtro geral.
    const old = localStorage.getItem(legacyKey);
    if (!old) return EMPTY_FILTER;
    const f = JSON.parse(old) as { status?: DealStatus | "all"; ownerIds?: string[]; tagIds?: string[] };
    return {
      status: f.status && f.status in STATUS_LABEL ? f.status : "open",
      ownerIds: Array.isArray(f.ownerIds) ? f.ownerIds : [],
      tagIdsByKind: Array.isArray(f.tagIds) && f.tagIds.length ? { [kind]: f.tagIds } : {},
    };
  } catch {
    return EMPTY_FILTER;
  }
}

function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, nv);
      } catch {
        /* preferência só desta tela */
      }
    },
  ];
}

function Menu<T extends string>({ value, labels, onChange, icon }: { value: T; labels: Record<T, string>; onChange: (v: T) => void; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
      >
        {icon}
        {labels[value]}
        <ChevronDown size={14} className="text-gray-400" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="left-auto right-0 min-w-[200px] py-1">
        {(Object.keys(labels) as T[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              onChange(k);
              setOpen(false);
            }}
            className={cn(
              "block w-full px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5",
              k === value ? "font-medium text-brand-600" : "text-gray-700 dark:text-gray-300",
            )}
          >
            {labels[k]}
          </button>
        ))}
      </Popover>
    </div>
  );
}

export function Board({
  pipeline,
  refreshKey,
  sidebarOpen,
  onToggleSidebar,
  onCreateCard,
  onOpenCard,
  onEditPipeline,
  onShowStats,
}: {
  pipeline: Pipeline;
  refreshKey: number;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCreateCard: (stageId: string) => void;
  onOpenCard: (id: string) => void;
  onEditPipeline: () => void;
  onShowStats: () => void;
}) {
  const { users, user } = useSession();
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [search, setSearch] = useState("");
  const [view, setView] = usePref<BoardView>("conectcrm-board-view", "all");
  const [sort, setSort] = usePref<BoardSort>("conectcrm-board-sort", "recent");
  // Quadro (Kanban) ou lista; colunas da lista lembradas por funil e usuário.
  const [mode, setMode] = usePref<"kanban" | "lista">("conectcrm-board-mode", "kanban");
  const listKey = `conectcrm-list-columns-${user.id}-${pipeline.id}`;
  const [listCols, setListCols] = useState(() => loadListColumns(listKey, pipeline.type));
  const [listLoadedKey, setListLoadedKey] = useState(listKey);
  if (listLoadedKey !== listKey) {
    setListLoadedKey(listKey);
    setListCols(loadListColumns(listKey, pipeline.type));
  }
  const saveListCols = (keys: string[]) => {
    setListCols(keys);
    try {
      localStorage.setItem(listKey, JSON.stringify(keys));
    } catch {
      /* preferência só desta tela */
    }
  };
  const fieldOptions = useCardFieldOptions(pipeline);
  // Atividade aberta (ou nova) pelo indicador do cartão.
  const [activityModal, setActivityModal] = useState<TaskRequest | null>(null);
  // Etapas recolhidas (coluna estreita), lembradas por funil e usuário.
  const collapsedKey = `conectcrm-board-collapsed-${user.id}-${pipeline.id}`;
  const readCollapsed = () => {
    try {
      const v = JSON.parse(localStorage.getItem(collapsedKey) ?? "[]") as unknown;
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  };
  const [collapsed, setCollapsedState] = useState<Set<string>>(readCollapsed);
  const [collapsedLoadedKey, setCollapsedLoadedKey] = useState(collapsedKey);
  if (collapsedLoadedKey !== collapsedKey) {
    setCollapsedLoadedKey(collapsedKey);
    setCollapsedState(readCollapsed());
  }
  const setCollapsed = (next: Set<string>) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(collapsedKey, JSON.stringify([...next]));
    } catch {
      /* preferência só desta tela */
    }
  };
  const toggleStage = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };
  // Com alguma etapa recolhida, o botão geral expande todas; sem nenhuma, recolhe todas.
  const anyCollapsed = columns.some((c) => collapsed.has(c.id));
  // Filtro lembrado por usuário, o mesmo em todos os funis (tags por tipo de cartão).
  const kind = CARD_TEXT[pipeline.type].kind;
  const filterKey = `conectcrm-board-filter-${user.id}`;
  const [filter, setFilter] = useState<BoardFilter>(() => loadFilter(filterKey, `${filterKey}-${pipeline.id}`, kind));
  const [loadedKey, setLoadedKey] = useState(filterKey);
  if (loadedKey !== filterKey) {
    setLoadedKey(filterKey);
    setFilter(loadFilter(filterKey, `${filterKey}-${pipeline.id}`, kind));
  }
  const saveFilter = (next: BoardFilter) => {
    setFilter(next);
    try {
      localStorage.setItem(filterKey, JSON.stringify(next));
    } catch {
      /* preferência só desta tela */
    }
  };
  const { status, ownerIds } = filter;
  const tagIds = useMemo(() => filter.tagIdsByKind[kind] ?? [], [filter.tagIdsByKind, kind]);
  const setStatus = (v: DealStatus | "all") => saveFilter({ ...filter, status: v });
  const setOwnerIds = (v: string[]) => saveFilter({ ...filter, ownerIds: v });
  const setTagIds = (v: string[]) => saveFilter({ ...filter, tagIdsByKind: { ...filter.tagIdsByKind, [kind]: v } });
  const [tags, setTags] = useState<Tag[]>([]);
  // Cartões escondidos pelo filtro de responsáveis/tags (aviso acima do quadro).
  const [hiddenByFilter, setHiddenByFilter] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null);
  const [drop, setDrop] = useState<{ stageId: string; beforeId: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const fieldKeys = mode === "lista" ? listCols.filter((k) => k !== STAGE_COLUMN) : undefined;
      const [cols, hidden] = await Promise.all([
        call("board.get", { pipelineId: pipeline.id, view, sort, status, search, ownerIds, tagIds, fieldKeys }),
        call("board.hiddenByFilter", { pipelineId: pipeline.id, view, status, search, ownerIds, tagIds }),
      ]);
      setColumns(cols);
      setHiddenByFilter(hidden);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [pipeline.id, view, sort, status, search, ownerIds, tagIds, mode, listCols]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey, search, user.id]);

  // Tags do tipo de cartão do funil aberto (o tipo vem junto: evita misturar ao trocar de funil).
  const [tagsKind, setTagsKind] = useState<DealKind | null>(null);
  useEffect(() => {
    void call("tags.list", { entity: kind }).then((list) => {
      setTags(list);
      setTagsKind(kind);
    });
  }, [kind]);

  // Tag ou usuário salvo no filtro que deixou de existir: sai do filtro.
  useEffect(() => {
    if (tagsKind !== kind || users.length === 0) return;
    const keepTags = tagIds.filter((id) => tags.some((t) => t.id === id));
    const keepOwners = ownerIds.filter((id) => users.some((u) => u.id === id));
    if (keepTags.length !== tagIds.length || keepOwners.length !== ownerIds.length)
      saveFilter({ ...filter, ownerIds: keepOwners, tagIdsByKind: { ...filter.tagIdsByKind, [kind]: keepTags } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagsKind, tags, users, filterKey]);

  // Resumo ao lado de "Filtrar": status (sempre, inclusive "Abertos"), responsáveis e tags.
  const filterParts = [
    statusLabels(pipeline.type)[status],
    ...ownerIds.map((id) => users.find((u) => u.id === id)?.name).filter((n): n is string => !!n),
    ...tagIds.map((id) => tags.find((t) => t.id === id)?.name).filter((n): n is string => !!n),
  ];
  const filterCount = filterParts.length;

  // ----- Arrastar e soltar (HTML5) -----
  const onDragOver = (e: React.DragEvent, stageId: string) => {
    if (!drag) return;
    e.preventDefault();
    let beforeId: string | null = null;
    if (sort === "manual") {
      const els = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-card-id]"));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          beforeId = el.dataset.cardId!;
          break;
        }
      }
      if (beforeId === drag.id) beforeId = null;
    }
    if (drop?.stageId !== stageId || drop.beforeId !== beforeId) setDrop({ stageId, beforeId });
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const d = drag;
    const target = drop;
    setDrag(null);
    setDrop(null);
    if (!d || !target) return;
    if (target.stageId === d.from && sort !== "manual") return;
    // Atualização otimista: o cartão já aparece na nova coluna.
    setColumns((cols) => {
      const card = cols.flatMap((c) => c.cards).find((c) => c.id === d.id);
      if (!card) return cols;
      return cols.map((c) => {
        let cards = c.cards.filter((x) => x.id !== d.id);
        if (c.id === target.stageId) {
          const idx = target.beforeId ? cards.findIndex((x) => x.id === target.beforeId) : -1;
          cards = idx >= 0 ? [...cards.slice(0, idx), card, ...cards.slice(idx)] : sort === "manual" ? [...cards, card] : [card, ...cards];
        }
        return { ...c, cards, count: cards.length, total_cents: cards.reduce((a, x) => a + x.value_cents, 0) };
      });
    });
    try {
      await call("cards.move", { id: d.id, stageId: target.stageId, beforeId: target.beforeId });
    } catch (err) {
      setError(errorText(err));
    }
    void load();
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
      {/* Cabeçalho */}
      <div className="mb-4 flex items-center gap-3">
        <button type="button" title={sidebarOpen ? "Esconder funis" : "Mostrar funis"} onClick={onToggleSidebar} className="text-gray-500 hover:text-gray-700">
          <PanelLeft size={20} />
        </button>
        <div className="flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700" role="group" aria-label="Visualização">
          {(
            [
              ["kanban", "Quadro (Kanban)", <Columns3 key="k" size={16} />],
              ["lista", "Lista", <List key="l" size={16} />],
            ] as const
          ).map(([m, title, icon]) => (
            <button
              key={m}
              type="button"
              title={title}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md",
                mode === m ? "bg-brand-500 text-white" : "text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5",
              )}
            >
              {icon}
            </button>
          ))}
        </div>
        <h1 className="truncate text-theme-xl font-semibold text-gray-800 dark:text-white/90">{pipeline.name}</h1>
        <TaBadge color={TYPE_BADGE[pipeline.type]} label={PIPELINE_TYPE_LABEL[pipeline.type]} />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Indicadores do funil"
            onClick={onShowStats}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"
          >
            <BarChart3 size={18} />
          </button>
          <div className="relative">
            <button
              type="button"
              title="Mais opções"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"
            >
              <MoreHorizontal size={18} />
            </button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="left-auto right-0 min-w-[180px] py-1">
              <button
                type="button"
                className="block w-full px-3.5 py-2 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300"
                onClick={() => {
                  setMenuOpen(false);
                  onEditPipeline();
                }}
              >
                Editar funil e etapas
              </button>
              <button
                type="button"
                className="block w-full px-3.5 py-2 text-left text-theme-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300"
                onClick={() => {
                  setMenuOpen(false);
                  setImporting(true);
                }}
              >
                Importar planilha…
              </button>
            </Popover>
          </div>
        </div>
      </div>

      {/* Barra de ferramentas */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
          <input
            className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-theme-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-white/5 dark:text-white/90"
            placeholder="Pesquisar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium hover:bg-gray-100 dark:hover:bg-white/5",
              filterCount ? "text-brand-600" : "text-gray-700 dark:text-gray-300",
            )}
          >
            <Filter size={15} className="shrink-0" /> Filtrar{filterCount ? ` (${filterCount})` : ""}
            {filterCount > 0 && (
              <span title={filterParts.join(" · ")} className="max-w-[280px] truncate font-normal text-gray-600 dark:text-gray-400">
                {filterParts.join(" · ")}
              </span>
            )}
          </button>
          <Popover open={filterOpen} onClose={() => setFilterOpen(false)} className="w-72 p-4">
            <p className="mb-1.5 text-theme-xs font-semibold uppercase text-gray-400">Status</p>
            <div className="mb-3 flex flex-wrap gap-1">
              {(Object.keys(STATUS_LABEL) as (DealStatus | "all")[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-theme-xs",
                    status === s ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300",
                  )}
                >
                  {statusLabels(pipeline.type)[s]}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-theme-xs font-semibold uppercase text-gray-400">Responsável</p>
            <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={ownerIds.includes(u.id)}
                    onChange={(e) => setOwnerIds(e.target.checked ? [...ownerIds, u.id] : ownerIds.filter((x) => x !== u.id))}
                  />
                  {u.name}
                </label>
              ))}
            </div>
            {tags.length > 0 && (
              <>
                <p className="mb-1.5 text-theme-xs font-semibold uppercase text-gray-400">Tags</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={cn("rounded-full", tagIds.includes(t.id) ? "ring-2 ring-brand-300" : "opacity-70")}
                      onClick={() => setTagIds(tagIds.includes(t.id) ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}
                    >
                      <TagChip tag={t} />
                    </button>
                  ))}
                </div>
              </>
            )}
            {filterCount > 0 && (
              <button type="button" className="text-theme-sm text-brand-600 hover:underline" onClick={() => saveFilter(EMPTY_FILTER)}>
                Limpar filtros
              </button>
            )}
          </Popover>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {mode === "kanban" && columns.length > 0 && (
            <button
              type="button"
              title={anyCollapsed ? "Expandir todas as etapas" : "Recolher todas as etapas (depois expanda só as que precisar)"}
              onClick={() => setCollapsed(anyCollapsed ? new Set() : new Set(columns.map((c) => c.id)))}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {anyCollapsed ? <UnfoldHorizontal size={15} /> : <FoldHorizontal size={15} />}
              {anyCollapsed ? "Expandir etapas" : "Recolher etapas"}
            </button>
          )}
          <Menu value={view} labels={VIEW_LABEL} onChange={setView} />
          <Menu value={sort} labels={SORT_LABEL} onChange={setSort} />
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}

      {hiddenByFilter > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-theme-sm text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300" data-hidden-by-filter>
          <Filter size={15} className="shrink-0" />
          <span>
            {hiddenByFilter === 1 ? "1 cartão não aparece" : `${hiddenByFilter} cartões não aparecem`} por causa do filtro (
            {filterParts.slice(1).join(" · ")}).
          </span>
          <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => saveFilter({ ...filter, ownerIds: [], tagIdsByKind: { ...filter.tagIdsByKind, [kind]: [] } })}>
            Mostrar todos
          </button>
        </div>
      )}
      {mode === "lista" ? (
        <BoardList pipeline={pipeline} columns={columns} keys={listCols} options={fieldOptions} onChangeKeys={saveListCols} onOpenCard={onOpenCard} />
      ) : (
        /* Colunas */
        <div className="flex min-h-[60vh] flex-1 gap-4 overflow-x-auto pb-3 custom-scrollbar">
          {columns.map((col) =>
            collapsed.has(col.id) ? (
              // Etapa recolhida: coluna estreita com o nome na vertical; aceita cartões arrastados.
              <button
                key={col.id}
                type="button"
                title={`Expandir ${col.name}`}
                onClick={() => toggleStage(col.id)}
                onDragOver={(e) => onDragOver(e, col.id)}
                onDragLeave={() => setDrop(null)}
                onDrop={(e) => void onDrop(e)}
                className={cn(
                  "flex shrink-0 flex-col items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-3 hover:bg-gray-100 dark:bg-white/[0.03] dark:hover:bg-white/5",
                  drop?.stageId === col.id && "bg-brand-25 ring-2 ring-brand-200 dark:bg-brand-500/10",
                )}
              >
                <StagePill name={col.name} color={col.color} vertical />
                <span className="text-theme-xs font-bold text-gray-700 dark:text-gray-300">({col.count})</span>
                <OverdueBadge count={col.overdue_activities} />
                {/* Valor total da etapa (na vertical para caber na coluna estreita). */}
                {col.total_cents > 0 && <span className="text-theme-xs font-bold text-gray-700 [writing-mode:vertical-rl] dark:text-gray-300">{formatCents(col.total_cents)}</span>}
              </button>
            ) : (
              <div
                key={col.id}
                onDragOver={(e) => onDragOver(e, col.id)}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop(null);
                }}
                onDrop={(e) => void onDrop(e)}
                className={cn(
                  "flex w-[300px] shrink-0 flex-col rounded-xl bg-gray-50 p-3 transition-colors dark:bg-white/[0.03]",
                  drop?.stageId === col.id && "bg-brand-25 ring-2 ring-brand-200 dark:bg-brand-500/10",
                )}
              >
                <div className="mb-0.5 flex items-center gap-1.5 px-1">
                  <StagePill name={col.name} color={col.color} className="min-w-0" />
                  {/* Quantidade e valor na mesma linha: "2 - R$ 641,00" (valor sempre no comercial; nos outros tipos quando há). */}
                  <span className="shrink-0 whitespace-nowrap text-theme-xs font-bold text-gray-700 dark:text-gray-300" data-stage-summary>
                    ({col.count})
                    {(pipeline.type === "comercial" || col.total_cents > 0) && ` - ${formatCents(col.total_cents)}`}
                  </span>
                  <OverdueBadge count={col.overdue_activities} />
                  <span className="ml-auto flex shrink-0 items-center">
                    <button
                      type="button"
                      title="Editar funil e etapas"
                      onClick={onEditPipeline}
                      className="flex h-6 w-5 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-white/10"
                    >
                      <MoreVertical size={15} />
                    </button>
                    <button
                      type="button"
                      title="Recolher etapa"
                      onClick={() => toggleStage(col.id)}
                      className="flex h-6 w-5 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-white/10"
                    >
                      <ChevronLeft size={15} />
                    </button>
                  </span>
                </div>
                <div className="mb-3" />
                <div className="flex flex-1 flex-col gap-2.5">
                  {col.cards.map((card) => (
                    <div key={card.id}>
                      {drop?.stageId === col.id && drop.beforeId === card.id && <div className="mb-2 h-1 rounded bg-brand-400" />}
                      <KanbanCard
                        card={card}
                        pipeline={pipeline}
                        onOpenActivity={(id) => setActivityModal({ id })}
                        onNewActivity={() => setActivityModal({ dealId: card.id })}
                        onChanged={() => void load()}
                        dragging={drag?.id === card.id}
                        onOpen={() => onOpenCard(card.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", card.id);
                          setDrag({ id: card.id, from: col.id });
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setDrop(null);
                        }}
                      />
                    </div>
                  ))}
                  {sort === "manual" && drop?.stageId === col.id && drop.beforeId === null && drag && <div className="h-1 rounded bg-brand-400" />}
                  <button
                    type="button"
                    title={`Novo ${CARD_TEXT[pipeline.type].noun} em ${col.name}`}
                    onClick={() => onCreateCard(col.id)}
                    className="flex h-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 hover:border-brand-300 hover:text-brand-500 dark:border-gray-700"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
      {importing && <CardImportModal pipeline={pipeline} onClose={() => setImporting(false)} onImported={() => void load()} />}
      {activityModal && (
        <TaskModal
          request={activityModal}
          onClose={() => setActivityModal(null)}
          onSaved={() => {
            setActivityModal(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

/** Relógio com o número de atividades atrasadas da etapa (só quando há). */
function OverdueBadge({ count }: { count: number }) {
  if (!count) return null;
  const label = `${count} atividade${count > 1 ? "s" : ""} atrasada${count > 1 ? "s" : ""} nesta etapa`;
  return (
    <span title={label} aria-label={label} data-stage-overdue={count} className="relative mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-gray-500 shadow-theme-xs dark:bg-white/10 dark:text-gray-300">
      <Clock size={14} />
      <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error-500 px-1 text-[10px] font-bold leading-none text-white">
        {count > 99 ? "99+" : count}
      </span>
    </span>
  );
}
