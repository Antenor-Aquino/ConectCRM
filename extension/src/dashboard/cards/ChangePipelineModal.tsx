// Mudar o cartão de funil ou cloná-lo num funil de qualquer tipo. Se o destino
// tiver uma etapa com o mesmo nome, ela já vem escolhida; senão o usuário
// escolhe a etapa. Mudando de tipo (negócio ↔ ticket ↔ etapa de projeto), tags e
// campos personalizados de mesmo nome são levados.
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Pipeline, Stage } from "../../db/pipelines";
import { CARD_TEXT, PIPELINE_TYPE_LABEL, PIPELINE_TYPE_ORDER } from "../../lib/cardTypes";
import { errorText } from "../../lib/errors";
import { normalizeText } from "../../lib/search";
import { ErrorText, Field } from "../ui/form";
import { StagePill } from "../ui/StageSelect";

/** Campos que só existem num tipo (ficam guardados ao mudar; não vão para a cópia). */
const ONLY_IN: Record<Pipeline["type"], { kept: string; notCopied: string }> = {
  comercial: { kept: "a previsão de fechamento fica guardada, mas não aparece", notCopied: "a previsão de fechamento não vai para a cópia" },
  operacional: { kept: "o SLA fica guardado, mas não aparece", notCopied: "o SLA não vai para a cópia" },
  projeto: { kept: "o início e o prazo ficam guardados, mas não aparecem", notCopied: "o início e o prazo não vão para a cópia" },
};

export function ChangePipelineModal({
  mode,
  cardId,
  cardTitle,
  pipeline,
  currentStage,
  pipelines,
  onClose,
  onDone,
}: {
  mode: "move" | "clone";
  cardId: string;
  cardTitle: string;
  pipeline: Pipeline;
  currentStage: Stage | undefined;
  pipelines: Pipeline[];
  onClose: () => void;
  /** Funil de destino e o cartão (o mesmo, ou a cópia). */
  onDone: (pipelineId: string, cardId: string) => void;
}) {
  const clone = mode === "clone";
  const options = pipelines.filter((p) => clone || p.id !== pipeline.id);
  const [targetId, setTargetId] = useState(clone ? pipeline.id : (options.find((p) => p.type === pipeline.type) ?? options[0])?.id ?? "");
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState("");
  const [title, setTitle] = useState(`${cardTitle} (cópia)`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const same = (s: Stage) => !!currentStage && normalizeText(s.name) === normalizeText(currentStage.name);
  const match = stages.find(same);
  useEffect(() => {
    setStages([]);
    setStageId("");
    if (!targetId) return;
    void call("stages.list", { pipelineId: targetId }).then((list) => {
      setStages(list);
      // No mesmo funil (cópia), a mesma etapa; nos outros, a de mesmo nome.
      const pick = targetId === pipeline.id ? list.find((s) => s.id === currentStage?.id) : list.find(same);
      setStageId(pick?.id ?? "");
    });
    // `same` depende só de currentStage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, currentStage, pipeline.id]);

  const target = options.find((p) => p.id === targetId);
  const typeChanges = !!target && target.type !== pipeline.type;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = clone
        ? await call("cards.clone", { id: cardId, pipelineId: targetId, stageId, title })
        : (await call("cards.changePipeline", { id: cardId, pipelineId: targetId, stageId }), cardId);
      onDone(targetId, id);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <TaModal isOpen onClose={onClose} title={clone ? "Clonar cartão" : "Mudar de funil"}>
      {options.length === 0 ? (
        <p className="text-theme-sm text-gray-500">Não há outro funil para onde levar este cartão.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-800 dark:text-white/90">{pipeline.name}</span>
            {currentStage && <StagePill name={currentStage.name} color={currentStage.color} />}
            <ArrowRight size={15} className="shrink-0 text-gray-400" />
            <span className="font-medium text-gray-800 dark:text-white/90">{target?.name}</span>
            {target && <span className="text-theme-xs text-gray-400">({PIPELINE_TYPE_LABEL[target.type]})</span>}
          </div>
          {clone && (
            <Field label="Nome da cópia">
              <TaInput value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          )}
          <Field label="Funil de destino">
            <TaSelect value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              {PIPELINE_TYPE_ORDER.filter((t) => options.some((p) => p.type === t)).map((t) => (
                <optgroup key={t} label={PIPELINE_TYPE_LABEL[t]}>
                  {options
                    .filter((p) => p.type === t)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.id === pipeline.id ? " (atual)" : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </TaSelect>
          </Field>
          {typeChanges && target && (
            <p className="mb-3 flex gap-2 rounded-lg bg-blue-light-50 px-3 py-2 text-theme-sm text-blue-light-700 dark:bg-blue-light-500/10 dark:text-blue-light-400" data-type-change>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                {clone ? "A cópia será" : "O cartão passa a ser"} <b>{CARD_TEXT[target.type].noun}</b> ({PIPELINE_TYPE_LABEL[target.type]}). Tags e campos personalizados de mesmo nome são
                levados; {clone ? ONLY_IN[pipeline.type].notCopied : ONLY_IN[pipeline.type].kept}.
              </span>
            </p>
          )}
          {stages.length > 0 && (
            <>
              {targetId !== pipeline.id && (
                <p
                  className={cn(
                    "mb-2 rounded-lg px-3 py-2 text-theme-sm",
                    match ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400" : "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400",
                  )}
                  data-stage-note
                >
                  {match
                    ? `${clone ? "A cópia" : "O cartão"} vai para a etapa correspondente "${match.name}". Se preferir, escolha outra.`
                    : `O funil ${target?.name} não tem a etapa "${currentStage?.name ?? ""}". Escolha para qual etapa ${clone ? "a cópia" : "o cartão"} vai.`}
                </p>
              )}
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
          {clone && <p className="text-theme-xs text-gray-500">Vão para a cópia: valor, produtos, contato, organização, responsável, tags e campos personalizados. Atividades, notas e documentos ficam só no original.</p>}
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="mt-4 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        {options.length > 0 && (
          <TaButton variant="primary" disabled={!stageId || busy || (clone && !title.trim())} onClick={() => void confirm()}>
            {clone ? "Clonar" : "Mudar de funil"}
          </TaButton>
        )}
      </div>
    </TaModal>
  );
}
