// Quadro Kanban do funil (tela inicial do mockup): busca, filtros, visões
// Fluxo geral / Meu fluxo / Minha equipe, ordenação, colunas com quantidade
// e soma, "+" tracejado por coluna e arrastar cartões entre etapas.
import { useCallback, useEffect, useState } from "react";
import { BarChart3, ChevronDown, Filter, MoreHorizontal, PanelLeft, Plus, Search } from "lucide-react";
import { TaBadge, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { BoardColumn, BoardSort, BoardView, DealStatus } from "../../db/deals";
import type { Pipeline } from "../../db/pipelines";
import type { Tag } from "../../db/tags";
import { CARD_TEXT, PIPELINE_TYPE_LABEL } from "../../lib/cardTypes";
import { formatCents } from "../../lib/format";
import { useSession } from "../session";
import { Popover } from "../ui/Popover";
import { StageDot } from "../ui/StageSelect";
import { TagChip } from "../ui/TagPicker";
import { KanbanCard } from "./KanbanCard";

const VIEW_LABEL: Record<BoardView, string> = { all: "Fluxo geral", mine: "Meu fluxo", team: "Minha equipe" };
const SORT_LABEL: Record<BoardSort, string> = {
  recent: "Mais recentes",
  updated: "Atualizados recentemente",
  manual: "Ordem manual",
  value: "Maior valor",
  title: "Nome (A–Z)",
};
const STATUS_LABEL: Record<DealStatus | "all", string> = { open: "Abertos", won: "Ganhos", lost: "Perdidos", all: "Todos" };
const TYPE_BADGE = { comercial: "blue", operacional: "purple", projeto: "cyan" } as const;

interface BoardFilter {
  status: DealStatus | "all";
  ownerIds: string[];
  tagIds: string[];
}
const EMPTY_FILTER: BoardFilter = { status: "open", ownerIds: [], tagIds: [] };

function loadFilter(key: string): BoardFilter {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_FILTER;
    const f = JSON.parse(raw) as Partial<BoardFilter>;
    return {
      status: f.status && f.status in STATUS_LABEL ? f.status : "open",
      ownerIds: Array.isArray(f.ownerIds) ? f.ownerIds : [],
      tagIds: Array.isArray(f.tagIds) ? f.tagIds : [],
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
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5">
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
            className={cn("block w-full px-3.5 py-2 text-left text-theme-sm hover:bg-gray-50 dark:hover:bg-white/5", k === value ? "font-medium text-brand-600" : "text-gray-700 dark:text-gray-300")}
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
  // Filtro lembrado por funil e usuário: ao voltar, vale o último escolhido.
  const filterKey = `conectcrm-board-filter-${user.id}-${pipeline.id}`;
  const [filter, setFilter] = useState<BoardFilter>(() => loadFilter(filterKey));
  const [loadedKey, setLoadedKey] = useState(filterKey);
  if (loadedKey !== filterKey) {
    setLoadedKey(filterKey);
    setFilter(loadFilter(filterKey));
  }
  const updateFilter = (patch: Partial<BoardFilter>) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    try {
      localStorage.setItem(filterKey, JSON.stringify(next));
    } catch {
      /* preferência só desta tela */
    }
  };
  const { status, ownerIds, tagIds } = filter;
  const setStatus = (v: DealStatus | "all") => updateFilter({ status: v });
  const setOwnerIds = (v: string[]) => updateFilter({ ownerIds: v });
  const setTagIds = (v: string[]) => updateFilter({ tagIds: v });
  const [tags, setTags] = useState<Tag[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null);
  const [drop, setDrop] = useState<{ stageId: string; beforeId: string | null } | null>(null);

  const kind = CARD_TEXT[pipeline.type].kind;
  const load = useCallback(async () => {
    try {
      setColumns(await call("board.get", { pipelineId: pipeline.id, view, sort, status, search, ownerIds, tagIds }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pipeline.id, view, sort, status, search, ownerIds, tagIds]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey, search, user.id]);

  const [tagsLoaded, setTagsLoaded] = useState(false);
  useEffect(() => {
    void call("tags.list", { entity: kind }).then((list) => {
      setTags(list);
      setTagsLoaded(true);
    });
  }, [kind]);

  // Tag ou usuário salvo no filtro que deixou de existir: sai do filtro.
  useEffect(() => {
    if (!tagsLoaded || users.length === 0) return;
    const keepTags = tagIds.filter((id) => tags.some((t) => t.id === id));
    const keepOwners = ownerIds.filter((id) => users.some((u) => u.id === id));
    if (keepTags.length !== tagIds.length || keepOwners.length !== ownerIds.length) updateFilter({ tagIds: keepTags, ownerIds: keepOwners });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagsLoaded, tags, users, filterKey]);

  // Resumo ao lado de "Filtrar": status (se não for o padrão), responsáveis e tags.
  const filterParts = [
    ...(status !== "open" ? [STATUS_LABEL[status]] : []),
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
      setError(err instanceof Error ? err.message : String(err));
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
        <h1 className="truncate text-theme-xl font-semibold text-gray-800 dark:text-white/90">{pipeline.name}</h1>
        <TaBadge color={TYPE_BADGE[pipeline.type]} label={PIPELINE_TYPE_LABEL[pipeline.type]} />
        <div className="ml-auto flex items-center gap-1">
          <button type="button" title="Indicadores do funil" onClick={onShowStats} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
            <BarChart3 size={18} />
          </button>
          <div className="relative">
            <button type="button" title="Mais opções" onClick={() => setMenuOpen((o) => !o)} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
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
            className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium hover:bg-gray-100 dark:hover:bg-white/5", filterCount ? "text-brand-600" : "text-gray-700 dark:text-gray-300")}
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
                <button key={s} type="button" onClick={() => setStatus(s)} className={cn("rounded-full px-2.5 py-1 text-theme-xs", status === s ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-700 dark:bg-white/5 dark:text-gray-300")}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="mb-1.5 text-theme-xs font-semibold uppercase text-gray-400">Responsável</p>
            <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-theme-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={ownerIds.includes(u.id)} onChange={(e) => setOwnerIds(e.target.checked ? [...ownerIds, u.id] : ownerIds.filter((x) => x !== u.id))} />
                  {u.name}
                </label>
              ))}
            </div>
            {tags.length > 0 && (
              <>
                <p className="mb-1.5 text-theme-xs font-semibold uppercase text-gray-400">Tags</p>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <button key={t.id} type="button" className={cn("rounded-full", tagIds.includes(t.id) ? "ring-2 ring-brand-300" : "opacity-70")} onClick={() => setTagIds(tagIds.includes(t.id) ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}>
                      <TagChip tag={t} />
                    </button>
                  ))}
                </div>
              </>
            )}
            {filterCount > 0 && (
              <button type="button" className="text-theme-sm text-brand-600 hover:underline" onClick={() => updateFilter(EMPTY_FILTER)}>
                Limpar filtros
              </button>
            )}
          </Popover>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Menu value={view} labels={VIEW_LABEL} onChange={setView} />
          <Menu value={sort} labels={SORT_LABEL} onChange={setSort} />
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}

      {/* Colunas */}
      <div className="flex min-h-[60vh] flex-1 gap-4 overflow-x-auto pb-3 custom-scrollbar">
        {columns.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => onDragOver(e, col.id)}
            onDragLeave={(e) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop(null);
            }}
            onDrop={(e) => void onDrop(e)}
            className={cn("flex w-[300px] shrink-0 flex-col rounded-xl bg-gray-50 p-3 transition-colors dark:bg-white/[0.03]", drop?.stageId === col.id && "bg-brand-25 ring-2 ring-brand-200 dark:bg-brand-500/10")}
          >
            <div className="mb-0.5 flex items-center gap-2 px-1">
              <StageDot color={col.color} />
              <span className="truncate text-theme-sm font-semibold text-gray-800 dark:text-white/90">{col.name}</span>
              <span className="text-theme-xs text-gray-400">{col.count}</span>
            </div>
            {pipeline.type === "comercial" && <div className="mb-3 px-1 text-theme-xs text-gray-500">{formatCents(col.total_cents)}</div>}
            {pipeline.type !== "comercial" && <div className="mb-2" />}
            <div className="flex flex-1 flex-col gap-2.5">
              {col.cards.map((card) => (
                <div key={card.id}>
                  {drop?.stageId === col.id && drop.beforeId === card.id && <div className="mb-2 h-1 rounded bg-brand-400" />}
                  <KanbanCard
                    card={card}
                    pipeline={pipeline}
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
        ))}
      </div>
    </section>
  );
}
