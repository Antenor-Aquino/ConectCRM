// Cartão com financeiro não se exclui (spec 13): explica o motivo e oferece o
// caminho certo — arquivar (sai do quadro, continua no banco e nos relatórios).
import { Archive } from "lucide-react";
import { TaButton, TaModal } from "@tailadmin";
import type { BlockedCard } from "../../lib/finance/deleteGuard";
import { formatCents } from "../../lib/format";

export interface BlockedItem extends BlockedCard {
  title: string;
  archived: boolean;
}

export function DeleteBlockedDialog({
  items,
  freeCount,
  offlineReason,
  busy,
  onArchive,
  onDeleteFree,
  onOpenFinance,
  onClose,
}: {
  items: BlockedItem[];
  /** Em lote: quantos outros podem ser excluídos normalmente. */
  freeCount: number;
  offlineReason: string | null;
  busy?: boolean;
  onArchive: () => void;
  onDeleteFree?: () => void;
  /** Cartão único: abre a aba Financeiro. */
  onOpenFinance?: () => void;
  onClose: () => void;
}) {
  const single = items.length === 1 && freeCount === 0;
  const toArchive = items.filter((i) => !i.archived);
  const unverified = items.filter((i) => i.reason === "unverified");
  return (
    <TaModal isOpen onClose={onClose} title={single ? "Este cartão não pode ser excluído" : "Alguns cartões não podem ser excluídos"} width="max-w-lg">
      <div data-delete-blocked className="space-y-3 text-theme-sm text-gray-600 dark:text-gray-400">
        <p>
          O lançamento na Gestão Financeira aponta para o cartão. Excluir o cartão faria o lançamento perder essa referência. Por isso, cartão
          com lançamentos só pode ser <b>arquivado</b>: ele sai do funil, mas continua no banco, na busca e nos relatórios.
        </p>
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-800">
          {items.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3" data-blocked-card={i.reason}>
              <span className="min-w-0 truncate font-medium text-gray-800 dark:text-white/90">{i.title}</span>
              <span className="shrink-0 text-theme-xs text-gray-500">
                {i.reason === "unverified"
                  ? "financeiro não confirmado"
                  : [
                      i.lock.entries ? `${i.lock.entries} lançamento${i.lock.entries === 1 ? "" : "s"}` : null,
                      i.lock.entries && (i.lock.incomeCents || i.lock.expenseCents)
                        ? `receitas ${formatCents(i.lock.incomeCents)} · despesas ${formatCents(i.lock.expenseCents)}`
                        : null,
                      i.lock.requests ? `${i.lock.requests} pedido${i.lock.requests === 1 ? "" : "s"} no pacote` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
        {unverified.length > 0 && (
          <p className="rounded-lg bg-warning-50 px-3 py-2 text-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
            Não consegui confirmar o financeiro de {unverified.length === 1 ? "um cartão" : `${unverified.length} cartões`}: a Gestão Financeira não respondeu
            {offlineReason ? ` (${offlineReason})` : ""}. Abra a Gestão Financeira e tente de novo, ou arquive.
          </p>
        )}
        <p>
          Para excluir de verdade: na Gestão Financeira, estorne os lançamentos pagos e exclua todos; depois tente novamente.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <TaButton size="sm" variant="ghost" onClick={onClose}>
          Cancelar
        </TaButton>
        {onOpenFinance && (
          <TaButton size="sm" onClick={onOpenFinance}>
            Ver Financeiro
          </TaButton>
        )}
        {onDeleteFree && freeCount > 0 && (
          <TaButton size="sm" disabled={busy} onClick={onDeleteFree} data-delete-free>
            Excluir só {freeCount === 1 ? "o outro" : `os outros ${freeCount}`}
          </TaButton>
        )}
        {toArchive.length > 0 && (
          <TaButton size="sm" variant="primary" disabled={busy} startIcon={<Archive size={14} />} onClick={onArchive} data-archive-instead>
            {toArchive.length === 1 ? "Arquivar" : `Arquivar ${toArchive.length}`}
          </TaButton>
        )}
      </div>
    </TaModal>
  );
}
