// Alterações não salvas: o editor avisa (useDraft), a tela que fecha pergunta
// (useLeaveGuard). O que foi digitado continua em memória enquanto a tela
// principal (o cartão) estiver aberta; para sair, é preciso salvar ou descartar.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TaButton, TaModal } from "@tailadmin";
import { clearDraft, listDrafts, markDraft, type DraftInfo } from "../../lib/drafts";

/** Escopo dos rascunhos: o cartão aberto fornece o id dele; fora disso vale "app". */
export const DraftScope = createContext<string>("app");

let counter = 0;

/**
 * Registra (ou limpa) o rascunho deste editor enquanto ele estiver montado.
 * `dirty` = há algo digitado que ainda não foi salvo. `label` pode mudar a cada
 * tecla (ex.: título): só é lido quando a pergunta aparece.
 */
export function useDraft(label: string, dirty: boolean, tab?: string): void {
  const scope = useContext(DraftScope);
  const key = useRef(`draft-${++counter}`);
  const text = useRef(label);
  text.current = label;
  useEffect(() => {
    if (dirty) markDraft({ key: key.current, scope, label: () => text.current, tab });
    else clearDraft(key.current);
  }, [dirty, scope, tab]);
  useEffect(() => {
    const k = key.current;
    return () => clearDraft(k);
  }, []);
}

/**
 * Antes de sair da tela do escopo (sem escopo: de qualquer tela): se há rascunho, pergunta.
 * `guard(acao)` roda a ação na hora (sem rascunho) ou depois de "Descartar e sair".
 * Não assina o registro: digitar não faz a tela que guarda renderizar de novo.
 */
export function useLeaveGuard(scope?: string): { guard: (action: () => void) => void; dialog: ReactNode } {
  const [asking, setAsking] = useState<{ action: () => void; items: DraftInfo[] } | null>(null);
  const guard = useCallback(
    (action: () => void) => {
      const items = listDrafts(scope);
      if (items.length) setAsking({ action, items });
      else action();
    },
    [scope],
  );
  const dialog = asking ? (
    <UnsavedDialog
      items={asking.items}
      onStay={() => setAsking(null)}
      onDiscard={() => {
        const { action } = asking;
        setAsking(null);
        // Descartado de propósito: some do registro, para a próxima tela não perguntar de novo.
        listDrafts(scope).forEach((d) => clearDraft(d.key));
        action();
      }}
    />
  ) : null;
  return { guard, dialog };
}

export function UnsavedDialog({
  items,
  confirmLabel = "Descartar e sair",
  onStay,
  onDiscard,
}: {
  items: DraftInfo[];
  confirmLabel?: string;
  onStay: () => void;
  onDiscard: () => void;
}) {
  return (
    <TaModal isOpen onClose={onStay} title="Existem itens não salvos" width="max-w-md">
      <div data-unsaved-dialog className="space-y-3 text-theme-sm text-gray-600 dark:text-gray-400">
        <p>O que você digitou ainda não foi salvo e será perdido se sair agora:</p>
        <ul className="list-disc space-y-0.5 pl-5 text-gray-800 dark:text-white/90">
          {items.map((d) => (
            <li key={d.key}>{d.label}</li>
          ))}
        </ul>
        <p>Volte e salve cada item, ou descarte para sair.</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <TaButton size="sm" variant="ghost" className="text-error-600" onClick={onDiscard} data-unsaved-discard>
          {confirmLabel}
        </TaButton>
        <TaButton size="sm" variant="primary" onClick={onStay} data-unsaved-stay autoFocus>
          Continuar editando
        </TaButton>
      </div>
    </TaModal>
  );
}
