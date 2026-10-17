// Editar funil (menu ⋯ do quadro): nome, etapas (cor, ordem, probabilidade,
// dias para "parado"), excluir etapa movendo os cartões, arquivar o funil.
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, badgePalette, type BadgeColor } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Pipeline } from "../../db/pipelines";
import { PIPELINE_TYPE_LABEL } from "../../lib/cardTypes";
import { ErrorText, Field, SectionLabel } from "../ui/form";

const COLORS = Object.keys(badgePalette) as BadgeColor[];

interface Draft {
  id?: string;
  name: string;
  color: string;
  probability: string;
  staleDays: string;
}

export function PipelineSettingsModal({ pipeline, onClose, onSaved }: { pipeline: Pipeline | null; onClose: () => void; onSaved: (archived: boolean) => void }) {
  const [name, setName] = useState("");
  const [stages, setStages] = useState<Draft[]>([]);
  const [original, setOriginal] = useState<{ id: string; name: string }[]>([]);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pipeline) return;
    setName(pipeline.name);
    setError(null);
    setMoveTo({});
    void call("stages.list", { pipelineId: pipeline.id }).then((list) => {
      setOriginal(list.map((s) => ({ id: s.id, name: s.name })));
      setStages(
        list.map((s) => ({ id: s.id, name: s.name, color: s.color ?? "slate", probability: s.probability?.toString() ?? "", staleDays: s.stale_days?.toString() ?? "" })),
      );
    });
  }, [pipeline]);

  if (!pipeline) return null;
  const removed = original.filter((o) => !stages.some((s) => s.id === o.id));
  const keptIds = stages.filter((s) => s.id);
  const set = (i: number, patch: Partial<Draft>) => setStages((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const swap = (i: number, j: number) =>
    setStages((l) => {
      if (j < 0 || j >= l.length) return l;
      const c = [...l];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });

  async function save() {
    setError(null);
    try {
      await call("pipelines.update", { id: pipeline!.id, patch: { name } });
      await call("stages.save", {
        pipelineId: pipeline!.id,
        stages: stages.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          probability: s.probability === "" ? null : Number(s.probability),
          staleDays: s.staleDays === "" ? null : Number(s.staleDays),
        })),
        moveTo,
      });
      onSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <TaModal isOpen onClose={onClose} title="Editar funil" width="max-w-2xl">
      <Field label="Nome do funil" required>
        <TaInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="text-theme-xs text-gray-500">Tipo: {PIPELINE_TYPE_LABEL[pipeline.type]} (não pode ser alterado).</p>

      <SectionLabel>Etapas</SectionLabel>
      <div className="grid grid-cols-[110px_1fr_90px_90px_64px] gap-2 text-theme-xs text-gray-500">
        <span>Cor</span>
        <span>Nome</span>
        <span>{pipeline.type === "comercial" ? "Prob. %" : ""}</span>
        <span>Parado após (dias)</span>
        <span />
      </div>
      {stages.map((s, i) => (
        <div key={s.id ?? `new-${i}`} className="mt-2 grid grid-cols-[110px_1fr_90px_90px_64px] items-center gap-2">
          <TaSelect value={s.color} onChange={(e) => set(i, { color: e.target.value })} style={{ color: badgePalette[s.color as BadgeColor]?.fg }}>
            {COLORS.map((c) => (
              <option key={c} value={c} style={{ color: badgePalette[c].fg }}>
                ● {c}
              </option>
            ))}
          </TaSelect>
          <TaInput value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
          {pipeline.type === "comercial" ? (
            <TaInput type="number" min={0} max={100} value={s.probability} onChange={(e) => set(i, { probability: e.target.value })} />
          ) : (
            <span />
          )}
          <TaInput type="number" min={1} value={s.staleDays} onChange={(e) => set(i, { staleDays: e.target.value })} />
          <div className="flex items-center gap-1 text-gray-400">
            <button type="button" title="Subir" onClick={() => swap(i, i - 1)}><ArrowUp size={14} /></button>
            <button type="button" title="Descer" onClick={() => swap(i, i + 1)}><ArrowDown size={14} /></button>
            <button type="button" title="Remover" disabled={stages.length === 1} className="hover:text-error-600 disabled:opacity-30" onClick={() => setStages((l) => l.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
      <TaButton variant="ghost" className="mt-2" startIcon={<Plus size={14} />} onClick={() => setStages((l) => [...l, { name: "", color: COLORS[l.length % COLORS.length]!, probability: "", staleDays: "" }])}>
        Adicionar etapa
      </TaButton>

      {removed.length > 0 && (
        <>
          <SectionLabel>Cartões das etapas removidas</SectionLabel>
          {removed.map((r) => (
            <Field key={r.id} label={`Mover cartões de "${r.name}" para`}>
              <TaSelect value={moveTo[r.id] ?? ""} onChange={(e) => setMoveTo({ ...moveTo, [r.id]: e.target.value })}>
                <option value="">(só necessário se a etapa tiver cartões)</option>
                {keptIds.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </TaSelect>
            </Field>
          ))}
        </>
      )}

      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex items-center gap-2">
        <TaButton
          variant="danger"
          onClick={async () => {
            if (!confirm("Arquivar este funil? Ele sai da lista, mas os dados são mantidos.")) return;
            await call("pipelines.update", { id: pipeline.id, patch: { archived: true } });
            onSaved(true);
          }}
        >
          Arquivar funil
        </TaButton>
        <div className="ml-auto flex gap-2">
          <TaButton onClick={onClose}>Cancelar</TaButton>
          <TaButton variant="primary" onClick={() => void save()}>
            Salvar
          </TaButton>
        </div>
      </div>
    </TaModal>
  );
}
