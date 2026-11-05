// Rascunhos em memória: o que o usuário começou a digitar e ainda não salvou.
// Cada editor (nota, atividade, formulário...) avisa aqui quando tem algo não
// salvo; as telas consultam para avisar antes de sair. Nada é gravado no banco
// nem no disco: salvar de verdade é sempre um clique do usuário.
import { useSyncExternalStore } from "react";

export interface DraftInfo {
  key: string;
  /** Onde o rascunho vale: id do cartão aberto ou "app" (qualquer tela). */
  scope: string;
  /** Texto mostrado na pergunta: "Nota nova", "Atividade: Ligar…". */
  label: string;
  /** Aba do cartão onde ele está (para marcar a aba). */
  tab?: string;
}

/** O texto pode ser uma função: é lido só quando a pergunta aparece, então digitar o título não reavalia as telas. */
export type DraftEntry = Omit<DraftInfo, "label"> & { label: string | (() => string) };

const drafts = new Map<string, DraftEntry>();
const listeners = new Set<() => void>();
let snapshot: DraftInfo[] = [];

const resolve = (d: DraftEntry): DraftInfo => ({ ...d, label: typeof d.label === "function" ? d.label() : d.label });

function emit(): void {
  snapshot = [...drafts.values()].map(resolve);
  listeners.forEach((l) => l());
}

export function markDraft(info: DraftEntry): void {
  const cur = drafts.get(info.key);
  drafts.set(info.key, info);
  // Só avisa as telas quando aparece, some ou muda de lugar; mudar o texto não precisa.
  if (cur && cur.scope === info.scope && cur.tab === info.tab) return;
  emit();
}

export function clearDraft(key: string): void {
  if (drafts.delete(key)) emit();
}

/** Rascunhos de um escopo (ou de todos), com os textos de agora. */
export function listDrafts(scope?: string): DraftInfo[] {
  return [...drafts.values()].filter((d) => scope === undefined || d.scope === scope).map(resolve);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => snapshot;

/** Lista reativa de rascunhos (de um escopo ou de todos). */
export function useDrafts(scope?: string): DraftInfo[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return scope === undefined ? all : all.filter((d) => d.scope === scope);
}

/** Só para testes. */
export function resetDrafts(): void {
  drafts.clear();
  emit();
}
