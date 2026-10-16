// Regras do botão "+" de cadastro rápido (spec 01, seção 3): Tarefa, Contato
// e Organização sempre; Negócio/Ticket/Etapa só se existir funil ativo do tipo.
import type { PipelineType } from "../db/pipelines";

export type QuickCreateId = "tarefa" | "contato" | "organizacao" | "negocio" | "ticket" | "projeto";

export interface QuickCreateOption {
  id: QuickCreateId;
  label: string;
  requires?: PipelineType;
}

export const QUICK_CREATE_OPTIONS: QuickCreateOption[] = [
  { id: "tarefa", label: "Tarefa" },
  { id: "contato", label: "Contato" },
  { id: "organizacao", label: "Organização" },
  { id: "negocio", label: "Negócio", requires: "comercial" },
  { id: "ticket", label: "Ticket", requires: "operacional" },
  { id: "projeto", label: "Etapa", requires: "projeto" },
];

export function visibleQuickCreateOptions(activeTypes: PipelineType[]): QuickCreateOption[] {
  return QUICK_CREATE_OPTIONS.filter((o) => !o.requires || activeTypes.includes(o.requires));
}
