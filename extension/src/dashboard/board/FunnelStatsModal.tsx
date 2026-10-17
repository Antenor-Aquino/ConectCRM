// Indicadores do funil (ícone de gráfico no cabeçalho do quadro): quantidade
// e valor por etapa, abertos, ganhos e perdidos. Relatórios completos: Fase 10.
import { useEffect, useState } from "react";
import { TaModal } from "@tailadmin";
import { call } from "../../rpc/client";
import type { BoardColumn } from "../../db/deals";
import type { Pipeline } from "../../db/pipelines";
import { formatCents } from "../../lib/format";
import { StageDot } from "../ui/StageSelect";

export function FunnelStatsModal({ pipeline, onClose }: { pipeline: Pipeline | null; onClose: () => void }) {
  const [cols, setCols] = useState<Record<"open" | "won" | "lost", BoardColumn[]> | null>(null);

  useEffect(() => {
    if (!pipeline) return;
    setCols(null);
    void Promise.all((["open", "won", "lost"] as const).map((status) => call("board.get", { pipelineId: pipeline.id, status }))).then(([open, won, lost]) =>
      setCols({ open: open!, won: won!, lost: lost! }),
    );
  }, [pipeline]);

  if (!pipeline) return null;
  const sum = (c: BoardColumn[]) => ({ n: c.reduce((a, x) => a + x.count, 0), v: c.reduce((a, x) => a + x.total_cents, 0) });
  const money = pipeline.type === "comercial";
  const tiles = cols
    ? ([
        ["Em aberto", sum(cols.open), "border-l-brand-500"],
        ["Ganhos", sum(cols.won), "border-l-success-500"],
        ["Perdidos", sum(cols.lost), "border-l-error-500"],
      ] as const)
    : [];
  const maxCount = Math.max(1, ...(cols?.open.map((c) => c.count) ?? [1]));

  return (
    <TaModal isOpen onClose={onClose} title={`Indicadores — ${pipeline.name}`} width="max-w-2xl">
      {!cols ? (
        <p className="text-theme-sm text-gray-500">Carregando…</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-3 gap-3">
            {tiles.map(([label, s, border]) => (
              <div key={label} className={`rounded-xl border border-gray-200 border-l-4 ${border} p-3 dark:border-gray-800`}>
                <p className="text-theme-xs text-gray-500">{label}</p>
                <p className="text-theme-xl font-semibold text-gray-800 dark:text-white/90">{s.n}</p>
                {money && <p className="text-theme-xs text-gray-500">{formatCents(s.v)}</p>}
              </div>
            ))}
          </div>
          <p className="mb-2 text-theme-xs font-semibold uppercase text-gray-400">Abertos por etapa</p>
          <div className="space-y-2">
            {cols.open.map((c) => (
              <div key={c.id} className="flex items-center gap-3 text-theme-sm">
                <span className="flex w-40 items-center gap-2 truncate text-gray-700 dark:text-gray-300">
                  <StageDot color={c.color} /> {c.name}
                </span>
                <div className="h-3 flex-1 rounded-full bg-gray-100 dark:bg-white/5">
                  <div className="h-3 rounded-full bg-brand-500" style={{ width: `${(c.count / maxCount) * 100}%` }} />
                </div>
                <span className="w-10 text-right text-gray-700 dark:text-gray-300">{c.count}</span>
                {money && <span className="w-28 text-right text-gray-500">{formatCents(c.total_cents)}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </TaModal>
  );
}
