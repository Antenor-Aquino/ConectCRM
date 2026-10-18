// Mudar o cartão de funil (do mesmo tipo). Se o destino tiver uma etapa com o
// mesmo nome, ela já vem escolhida; senão o usuário escolhe a etapa.
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { TaButton, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Pipeline, Stage } from "../../db/pipelines";
import { PIPELINE_TYPE_LABEL } from "../../lib/cardTypes";
import { errorText } from "../../lib/errors";
import { normalizeText } from "../../lib/search";
import { ErrorText, Field } from "../ui/form";
import { StagePill } from "../ui/StageSelect";

export function ChangePipelineModal({
  cardId,
  pipeline,
  currentStage,
  pipelines,
  onClose,
  onMoved,
}: {
  cardId: string;
  pipeline: Pipeline;
  currentStage: Stage | undefined;
  /** Todos os funis; aqui aparecem só os do mesmo tipo. */
  pipelines: Pipeline[];
  onClose: () => void;
  onMoved: (pipelineId: string) => void;
}) {
  const options = pipelines.filter((p) => p.type === pipeline.type && p.id !== pipeline.id);
  const [targetId, setTargetId] = useState(options[0]?.id ?? "");
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const match = currentStage ? stages.find((s) => normalizeText(s.name) === normalizeText(currentStage.name)) : undefined;
  useEffect(() => {
    setStages([]);
    setStageId("");
    if (!targetId) return;
    void call("stages.list", { pipelineId: targetId }).then((list) => {
      setStages(list);
      const same = currentStage && list.find((s) => normalizeText(s.name) === normalizeText(currentStage.name));
      setStageId(same?.id ?? "");
    });
  }, [targetId, currentStage]);

  const target = options.find((p) => p.id === targetId);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await call("cards.changePipeline", { id: cardId, pipelineId: targetId, stageId });
      onMoved(targetId);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <TaModal isOpen onClose={onClose} title="Mudar de funil">
      {options.length === 0 ? (
        <p className="text-theme-sm text-gray-500">Não há outro funil do tipo {PIPELINE_TYPE_LABEL[pipeline.type]} para onde levar este cartão.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-800 dark:text-white/90">{pipeline.name}</span>
            {currentStage && <StagePill name={currentStage.name} color={currentStage.color} />}
            <ArrowRight size={15} className="shrink-0 text-gray-400" />
            <span className="font-medium text-gray-800 dark:text-white/90">{target?.name}</span>
          </div>
          <Field label="Funil de destino" hint={`Só funis do mesmo tipo (${PIPELINE_TYPE_LABEL[pipeline.type]}).`}>
            <TaSelect value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </TaSelect>
          </Field>
          {stages.length > 0 && (
            <>
              <p
                className={cn(
                  "mb-2 rounded-lg px-3 py-2 text-theme-sm",
                  match ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400" : "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400",
                )}
              >
                {match
                  ? `O cartão vai para a etapa correspondente "${match.name}". Se preferir, escolha outra.`
                  : `O funil ${target?.name} não tem a etapa "${currentStage?.name ?? ""}". Escolha para qual etapa o cartão vai.`}
              </p>
              <div className="mb-2 grid gap-1.5" role="radiogroup" aria-label="Etapa de destino">
                {stages.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={s.id === stageId}
                    data-stage-option={s.name}
                    onClick={() => setStageId(s.id)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-2 text-left transition",
                      s.id === stageId ? "border-brand-400 bg-brand-25 ring-1 ring-brand-300 dark:bg-brand-500/10" : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-white/5",
                    )}
                  >
                    <StagePill name={s.name} color={s.color} />
                    {s.id === stageId && <Check size={16} className="text-brand-600" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="mt-4 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        {options.length > 0 && (
          <TaButton variant="primary" disabled={!stageId || busy} onClick={() => void confirm()}>
            Mudar de funil
          </TaButton>
        )}
      </div>
    </TaModal>
  );
}
