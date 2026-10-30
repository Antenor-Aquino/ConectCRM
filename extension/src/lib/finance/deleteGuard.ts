// Antes de excluir cartões: confere o financeiro (spec 13). Quem tem lançamento
// não é excluído, só arquivado. A barreira definitiva fica no banco
// (`assertNoFinance`); aqui a tela lê a Gestão Financeira ao vivo, para a cópia
// local estar em dia, e explica o motivo em vez de só mostrar um erro.
import { call } from "../../rpc/client";
import type { CardFinanceLock } from "../../db/financeLock";
import { errorText } from "../errors";
import { listByOrigin, loadGfSettings } from "./gfBridge";

export interface BlockedCard {
  id: string;
  /** "finance": tem lançamento/pedido. "unverified": a Gestão Financeira não respondeu e não há cópia do cartão. */
  reason: "finance" | "unverified";
  lock: CardFinanceLock;
}

export interface DeleteCheck {
  free: string[];
  blocked: BlockedCard[];
  /** Por que não deu para ler a Gestão Financeira (quando não deu). */
  offlineReason: string | null;
}

/**
 * Só no modo direto a Gestão Financeira é a fonte da verdade: se ela não
 * respondeu e o cartão nunca foi lido, não dá para afirmar que não há
 * lançamento. No modo pacote, o CRM é quem cria os pedidos, então o banco sabe.
 */
export function classifyDelete(
  ids: string[],
  locks: Record<string, CardFinanceLock>,
  direct: boolean,
  liveOk: boolean,
  offlineReason: string | null = null,
): DeleteCheck {
  const free: string[] = [];
  const blocked: BlockedCard[] = [];
  for (const id of ids) {
    const lock = locks[id]!;
    if (lock.entries + lock.requests > 0) blocked.push({ id, reason: "finance", lock });
    else if (direct && !liveOk && !lock.synced) blocked.push({ id, reason: "unverified", lock });
    else free.push(id);
  }
  return { free, blocked, offlineReason };
}

export async function checkCardsForDelete(ids: string[]): Promise<DeleteCheck> {
  const s = await loadGfSettings();
  const direct = !!s.gfId && s.direct;
  let liveOk = false;
  let offlineReason: string | null = null;
  if (direct) {
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500);
        const r = await listByOrigin(s.gfId!, part);
        await call("finance.replace", { dealIds: part, items: r.items, env: r.env, at: r.at });
      }
      liveOk = true;
    } catch (e) {
      offlineReason = errorText(e);
    }
  }
  const locks = await call("cards.financeLocks", { ids });
  return classifyDelete(ids, locks, direct, liveOk, offlineReason);
}
