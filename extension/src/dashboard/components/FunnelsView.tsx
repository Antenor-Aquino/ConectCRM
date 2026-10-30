// Tela de Funis (tela inicial do mockup): lista de funis à esquerda e o
// quadro Kanban do funil selecionado.
import { useState } from "react";
import { ChevronsLeft, ChevronsRight, CircleDollarSign, FolderKanban, LifeBuoy, Plus } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import type { Pipeline, PipelineType } from "../../db/pipelines";
import { PIPELINE_TYPE_LABEL, PIPELINE_TYPE_ORDER } from "../../lib/cardTypes";
import { Board } from "../board/Board";
import { FunnelStatsModal } from "../board/FunnelStatsModal";
import { PipelineSettingsModal } from "../board/PipelineSettingsModal";
import { CardDetail, type CardDetailMode } from "../cards/CardDetail";
import { NewPipelineModal } from "./NewPipelineModal";

const TYPE_ICON: Record<PipelineType, React.ReactNode> = {
  comercial: <CircleDollarSign size={18} />,
  operacional: <LifeBuoy size={18} />,
  projeto: <FolderKanban size={18} />,
};

const SIDEBAR_KEY = "conectcrm-funnels-panel";

/** Sigla do funil na faixa recolhida: "Vendas AEB" → "VA"; "Suporte" → "SU". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2);
  return words[0]![0]! + words[1]![0]!;
}

export function FunnelsView({
  pipelines,
  selected,
  onSelect,
  refreshKey,
  onChanged,
  onCreateCard,
  openCardId,
  onOpenCard,
}: {
  pipelines: Pipeline[];
  selected: Pipeline | null;
  onSelect: (id: string) => void;
  refreshKey: number;
  /** Algo mudou (funis ou cartões): recarrega. */
  onChanged: () => Promise<void> | void;
  onCreateCard: (pipeline: Pipeline, stageId?: string) => void;
  openCardId: string | null;
  onOpenCard: (id: string | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stats, setStats] = useState(false);
  // Painel de funis retrátil: aberto ou recolhido numa faixa estreita (só as siglas); lembra a escolha.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "collapsed";
    } catch {
      return true;
    }
  });
  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "open" : "collapsed");
    } catch {
      /* preferência só desta tela */
    }
  };
  // Detalhe do cartão: painel lateral ou tela cheia (no lugar do quadro); lembra a escolha.
  const [cardMode, setCardMode] = useState<CardDetailMode>(() => {
    try {
      return localStorage.getItem("conectcrm-card-mode") === "full" ? "full" : "drawer";
    } catch {
      return "drawer";
    }
  });
  const toggleCardMode = () => {
    const next = cardMode === "full" ? "drawer" : "full";
    setCardMode(next);
    try {
      localStorage.setItem("conectcrm-card-mode", next);
    } catch {
      /* preferência só desta tela */
    }
  };
  const cardFull = !!openCardId && !!selected && cardMode === "full";

  return (
    <div className="flex gap-5">
      {sidebarOpen ? (
        <aside data-funnels-panel="open" className="w-60 shrink-0 self-start rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Funis</h2>
            <div className="flex items-center gap-0.5">
              <button type="button" title="Novo funil" onClick={() => setCreating(true)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
                <Plus size={16} />
              </button>
              <button type="button" title="Recolher funis" aria-label="Recolher funis" data-funnels-toggle onClick={toggleSidebar} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
                <ChevronsLeft size={16} />
              </button>
            </div>
          </div>
          {pipelines.length === 0 ? (
            <p className="text-theme-xs text-gray-500">Nenhum funil ainda.</p>
          ) : (
            <div className="space-y-4">
              {PIPELINE_TYPE_ORDER.filter((t) => pipelines.some((p) => p.type === t)).map((t) => (
                <section key={t}>
                  <h3 className="mb-1.5 border-b border-gray-200 pb-1.5 text-theme-sm font-bold text-gray-800 dark:border-gray-700 dark:text-white/90">{PIPELINE_TYPE_LABEL[t]}</h3>
                  <ul className="space-y-1">
                    {pipelines
                      .filter((p) => p.type === t)
                      .map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(p.id)}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-theme-sm transition-colors",
                              p.id === selected?.id ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
                            )}
                          >
                            <span className="shrink-0">{TYPE_ICON[p.type]}</span>
                            <span className="truncate">{p.name}</span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </aside>
      ) : (
        <aside data-funnels-panel="collapsed" className="flex w-14 shrink-0 flex-col items-center self-start rounded-2xl border border-gray-200 bg-white py-3 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <button type="button" title="Mostrar funis" aria-label="Mostrar funis" data-funnels-toggle onClick={toggleSidebar} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
            <ChevronsRight size={16} />
          </button>
          <button type="button" title="Novo funil" onClick={() => setCreating(true)} className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
            <Plus size={16} />
          </button>
          {PIPELINE_TYPE_ORDER.filter((t) => pipelines.some((p) => p.type === t)).map((t) => (
            <section key={t} className="flex w-full flex-col items-center gap-1 border-t border-gray-200 pt-2 mt-1 dark:border-gray-700" title={PIPELINE_TYPE_LABEL[t]}>
              {pipelines
                .filter((p) => p.type === t)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={`${p.name} · ${PIPELINE_TYPE_LABEL[t]}`}
                    aria-label={p.name}
                    onClick={() => onSelect(p.id)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-semibold uppercase transition-colors",
                      p.id === selected?.id ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
                    )}
                  >
                    {initials(p.name)}
                  </button>
                ))}
            </section>
          ))}
        </aside>
      )}

      {!selected ? (
        <section className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white py-16 text-center shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-1 text-base font-semibold text-gray-800 dark:text-white/90">Crie seu primeiro funil</p>
          <p className="mb-5 text-theme-sm text-gray-500">Comercial (negócios), Operacional (tickets) ou Projeto.</p>
          <TaButton variant="primary" startIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
            Novo funil
          </TaButton>
        </section>
      ) : cardFull ? null : (
        <Board
          pipeline={selected}
          refreshKey={refreshKey}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onCreateCard={(stageId) => onCreateCard(selected, stageId)}
          onOpenCard={onOpenCard}
          onEditPipeline={() => setEditing(true)}
          onShowStats={() => setStats(true)}
        />
      )}

      <NewPipelineModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onCreated={async (id) => {
          setCreating(false);
          await onChanged();
          onSelect(id);
        }}
      />
      {editing && selected && (
        <PipelineSettingsModal
          pipeline={selected}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void onChanged();
          }}
        />
      )}
      {stats && <FunnelStatsModal pipeline={selected} onClose={() => setStats(false)} />}
      {/* Sempre neste lugar da árvore, nos dois modos: alternar painel/tela cheia não remonta o cartão. */}
      {openCardId && selected && (
        <CardDetail
          key={openCardId}
          cardId={openCardId}
          pipeline={selected}
          mode={cardFull ? "full" : "drawer"}
          onToggleMode={toggleCardMode}
          onClose={() => onOpenCard(null)}
          onChanged={() => void onChanged()}
          pipelines={pipelines}
          onGoToCard={(pipelineId, cardId) => {
            // Abre o funil de destino com o cartão (o mesmo, ou a cópia).
            onSelect(pipelineId);
            onOpenCard(cardId);
          }}
        />
      )}
    </div>
  );
}
