// Criação de funil (spec 01, seção 10): nome, tipo (fixo depois de criado)
// e etapas com cor.
import { useEffect, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, badgePalette, type BadgeColor } from "@tailadmin";
import { call } from "../../rpc/client";
import type { PipelineType } from "../../db/pipelines";

const STAGE_COLORS = Object.keys(badgePalette) as BadgeColor[];

const DEFAULT_STAGES: Record<PipelineType, string[]> = {
  comercial: ["Prospect", "Contato", "Reunião", "Proposta", "Fechamento"],
  // Sem etapa "Resolvido"/"Concluído": o desfecho é marcado pelos botões do cartão.
  operacional: ["Novo ticket", "Em atendimento", "Aguardando cliente", "Em validação"],
  projeto: ["A fazer", "Em andamento", "Em revisão", "Entrega"],
};

interface DraftStage {
  name: string;
  color: BadgeColor;
}

function defaultsFor(type: PipelineType): DraftStage[] {
  return DEFAULT_STAGES[type].map((name, i) => ({ name, color: STAGE_COLORS[i % STAGE_COLORS.length]! }));
}

export function NewPipelineModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PipelineType>("comercial");
  const [stages, setStages] = useState<DraftStage[]>(defaultsFor("comercial"));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setType("comercial");
      setStages(defaultsFor("comercial"));
      setError(null);
    }
  }, [isOpen]);

  const updateStage = (i: number, patch: Partial<DraftStage>) =>
    setStages((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    setSaving(true);
    try {
      const id = await call("pipelines.create", { name, type, stages });
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <TaModal isOpen={isOpen} onClose={onClose} title="Novo funil">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Nome do funil *</span>
          <TaInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Vendas" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Tipo *</span>
          <TaSelect
            value={type}
            onChange={(e) => {
              const t = e.target.value as PipelineType;
              setType(t);
              setStages(defaultsFor(t));
            }}
          >
            <option value="comercial">Comercial — negócios</option>
            <option value="operacional">Operacional — tickets</option>
            <option value="projeto">Projeto — etapas de projeto</option>
          </TaSelect>
          <span className="mt-1 block text-theme-xs text-gray-500">O tipo não pode ser alterado depois.</span>
        </label>
        <div>
          <span className="mb-1.5 block text-theme-sm font-medium text-gray-700 dark:text-gray-300">Etapas</span>
          <div className="space-y-2">
            {stages.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <TaSelect
                  value={s.color}
                  onChange={(e) => updateStage(i, { color: e.target.value as BadgeColor })}
                  className="w-28 shrink-0"
                  style={{ color: badgePalette[s.color].fg }}
                >
                  {STAGE_COLORS.map((c) => (
                    <option key={c} value={c} style={{ color: badgePalette[c].fg }}>
                      ● {c}
                    </option>
                  ))}
                </TaSelect>
                <TaInput value={s.name} onChange={(e) => updateStage(i, { name: e.target.value })} />
                <button
                  type="button"
                  title="Remover etapa"
                  disabled={stages.length === 1}
                  onClick={() => setStages((list) => list.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-error-600 disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <TaButton
            variant="ghost"
            className="mt-2"
            startIcon={<Plus size={14} />}
            onClick={() => setStages((list) => [...list, { name: "", color: STAGE_COLORS[list.length % STAGE_COLORS.length]! }])}
          >
            Adicionar etapa
          </TaButton>
        </div>
        {error && <p className="text-theme-sm text-error-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <TaButton onClick={onClose}>Cancelar</TaButton>
          <TaButton variant="primary" disabled={saving} onClick={save}>
            Criar funil
          </TaButton>
        </div>
      </div>
    </TaModal>
  );
}
