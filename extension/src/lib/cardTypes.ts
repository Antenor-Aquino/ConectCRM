// Textos de cada tipo de funil/cartão (spec 01).
import type { DealKind, PipelineType } from "../db/pipelines";

export const PIPELINE_TYPE_LABEL: Record<PipelineType, string> = { comercial: "Comercial", operacional: "Operacional", projeto: "Projeto" };

/** Ordem das categorias de funil nas listas (dentro de cada uma, por nome). */
export const PIPELINE_TYPE_ORDER: PipelineType[] = ["comercial", "projeto", "operacional"];

export const CARD_TEXT: Record<
  PipelineType,
  { kind: DealKind; newTitle: string; noun: string; titleLabel: string; titlePlaceholder: string; pipelineSection: string; stageLabel: string }
> = {
  comercial: {
    kind: "deal",
    newTitle: "Nova negociação",
    noun: "negócio",
    titleLabel: "Nome da negociação",
    titlePlaceholder: "Ex.: Proposta de licenças 2026",
    pipelineSection: "Funil",
    stageLabel: "Etapa",
  },
  operacional: {
    kind: "ticket",
    newTitle: "Novo ticket",
    noun: "ticket",
    titleLabel: "Título do ticket",
    titlePlaceholder: "Ex: Falha no acesso do cliente",
    pipelineSection: "Funil operacional",
    stageLabel: "Etapa do ticket",
  },
  projeto: {
    kind: "project",
    newTitle: "Nova etapa",
    noun: "etapa",
    titleLabel: "Título",
    titlePlaceholder: "Ex.: Implantação na unidade Centro",
    pipelineSection: "Funil de projeto",
    stageLabel: "Etapa",
  },
};
