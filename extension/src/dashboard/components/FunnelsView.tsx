// Tela de Funis (spec 01): lista de funis à esquerda e o quadro do funil
// selecionado. Na Fase 0 o quadro mostra só as colunas; cartões, arrastar e
// filtros chegam nas Fases 2 e 4.
import { useEffect, useState } from "react";
import { CircleDollarSign, FolderKanban, LifeBuoy, Plus } from "lucide-react";
import { TaBadge, TaButton, badgePalette, cn, type BadgeColor } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Pipeline, PipelineType, Stage } from "../../db/pipelines";
import { NewPipelineModal } from "./NewPipelineModal";

export const PIPELINE_TYPE_LABEL: Record<PipelineType, string> = {
  comercial: "Comercial",
  operacional: "Operacional",
  projeto: "Projeto",
};

const TYPE_ICON: Record<PipelineType, React.ReactNode> = {
  comercial: <CircleDollarSign size={18} />,
  operacional: <LifeBuoy size={18} />,
  projeto: <FolderKanban size={18} />,
};

const TYPE_BADGE: Record<PipelineType, BadgeColor> = { comercial: "blue", operacional: "purple", projeto: "cyan" };

function stageColor(color: string | null): string {
  return badgePalette[(color as BadgeColor) ?? "slate"]?.fg ?? badgePalette.slate.fg;
}

export function FunnelsView({ pipelines, onChanged }: { pipelines: Pipeline[]; onChanged: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [creating, setCreating] = useState(false);

  const selected = pipelines.find((p) => p.id === selectedId) ?? pipelines[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setStages([]);
      return;
    }
    void call("stages.list", { pipelineId: selected.id }).then(setStages);
  }, [selected?.id]);

  return (
    <div className="flex gap-5">
      <aside className="w-60 shrink-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Funis</h2>
          <button
            type="button"
            title="Novo funil"
            onClick={() => setCreating(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5"
          >
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
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-theme-sm transition-colors",
                    p.id === selected?.id
                      ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5",
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

      <section className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white p-5 shadow-theme-xs dark:border-gray-800 dark:bg-gray-900">
        {!selected ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="mb-1 text-base font-semibold text-gray-800 dark:text-white/90">Crie seu primeiro funil</p>
            <p className="mb-5 text-theme-sm text-gray-500">Comercial (negócios), Operacional (tickets) ou Projeto.</p>
            <TaButton variant="primary" startIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Novo funil
            </TaButton>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-3">
              <h1 className="text-theme-xl font-semibold text-gray-800 dark:text-white/90">{selected.name}</h1>
              <TaBadge color={TYPE_BADGE[selected.type]} label={PIPELINE_TYPE_LABEL[selected.type]} />
            </div>
            <div className="flex gap-4 overflow-x-auto pb-3">
              {stages.map((s) => (
                <div key={s.id} className="w-72 shrink-0 rounded-xl bg-gray-50 p-3 dark:bg-white/[0.03]">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: stageColor(s.color) }} />
                    <span className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{s.name}</span>
                    <span className="text-theme-xs text-gray-400">0</span>
                  </div>
                  {selected.type === "comercial" && <div className="mb-3 text-theme-xs text-gray-500">R$ 0,00</div>}
                  <div className="mt-3 flex h-10 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-700">
                    <Plus size={16} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <NewPipelineModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onCreated={async (id) => {
          setCreating(false);
          await onChanged();
          setSelectedId(id);
        }}
      />
    </div>
  );
}
