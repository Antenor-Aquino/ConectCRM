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

/** Desfecho do cartão por tipo de funil. No banco é sempre won/lost; só os
 * termos mudam: Ganho/Perdido (comercial), Resolvido/Não resolvido
 * (operacional), Concluído/Não concluído (projeto). Verde e vermelho em todos. */
export interface OutcomeText {
  won: string;
  lost: string;
  wonPlural: string;
  lostPlural: string;
  /** "Marcar como perdido" / "Marcar como não resolvido"... */
  markLost: string;
  /** Histórico: "Marcou como ganho"... */
  markedWon: string;
  markedLost: string;
  lossReason: string;
  lossNote: string;
  rate: string;
  rateDetail: string;
  /** "até o ganho" / "até a resolução" / "até a conclusão" */
  cycle: string;
}

export const OUTCOME_TEXT: Record<PipelineType, OutcomeText> = {
  comercial: {
    won: "Ganho",
    lost: "Perdido",
    wonPlural: "Ganhos",
    lostPlural: "Perdidos",
    markLost: "Marcar como perdido",
    markedWon: "Marcou como ganho",
    markedLost: "Marcou como perdido",
    lossReason: "Motivo da perda",
    lossNote: "Observação da perda",
    rate: "Taxa de conversão",
    rateDetail: "ganhos ÷ (ganhos + perdidos)",
    cycle: "até o ganho",
  },
  operacional: {
    won: "Resolvido",
    lost: "Não resolvido",
    wonPlural: "Resolvidos",
    lostPlural: "Não resolvidos",
    markLost: "Marcar como não resolvido",
    markedWon: "Marcou como resolvido",
    markedLost: "Marcou como não resolvido",
    lossReason: "Motivo (não resolvido)",
    lossNote: "Observação (não resolvido)",
    rate: "Taxa de resolução",
    rateDetail: "resolvidos ÷ (resolvidos + não resolvidos)",
    cycle: "até a resolução",
  },
  projeto: {
    won: "Concluído",
    lost: "Não concluído",
    wonPlural: "Concluídos",
    lostPlural: "Não concluídos",
    markLost: "Marcar como não concluído",
    markedWon: "Marcou como concluído",
    markedLost: "Marcou como não concluído",
    lossReason: "Motivo (não concluído)",
    lossNote: "Observação (não concluído)",
    rate: "Taxa de conclusão",
    rateDetail: "concluídos ÷ (concluídos + não concluídos)",
    cycle: "até a conclusão",
  },
};

export const PIPELINE_TYPE_BY_KIND: Record<DealKind, PipelineType> = { deal: "comercial", ticket: "operacional", project: "projeto" };

/** Termo do status de um cartão ("Ganho", "Resolvido", "Não concluído"...); null se aberto. */
export function outcomeLabel(type: PipelineType, status: "open" | "won" | "lost"): string | null {
  return status === "open" ? null : OUTCOME_TEXT[type][status];
}
