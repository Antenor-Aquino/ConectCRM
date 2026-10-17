// Tela de Funis (tela inicial do mockup): lista de funis à esquerda e o
// quadro Kanban do funil selecionado.
import { useState } from "react";
import { CircleDollarSign, FolderKanban, LifeBuoy, Plus } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import type { Pipeline, PipelineType } from "../../db/pipelines";
import { Board } from "../board/Board";
import { FunnelStatsModal } from "../board/FunnelStatsModal";
import { PipelineSettingsModal } from "../board/PipelineSettingsModal";
import { CardDetail } from "../cards/CardDetail";
import { NewPipelineModal } from "./NewPipelineModal";

const TYPE_ICON: Record<PipelineType, React.ReactNode> = {
  comercial: <CircleDollarSign size={18} />,
  operacional: <LifeBuoy size={18} />,
  projeto: <FolderKanban size={18} />,
};

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
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex gap-5">
      {sidebarOpen && (
        <aside className="w-60 shrink-0 self-start rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Funis</h2>
            <button type="button" title="Novo funil" onClick={() => setCreating(true)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
              <Plus size={16} />
            </button>
          </div>
          {pipelines.length === 0 ? (
            <p className="text-theme-xs text-gray-500">Nenhum funil ainda.</p>
          ) : (
            <ul className="space-y-1">
              {pipelines.map((p) => (
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
          )}
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
      ) : (
        <Board
          pipeline={selected}
          refreshKey={refreshKey}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
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
      {openCardId && selected && (
        <CardDetail cardId={openCardId} pipeline={selected} onClose={() => onOpenCard(null)} onChanged={() => void onChanged()} />
      )}
    </div>
  );
}
