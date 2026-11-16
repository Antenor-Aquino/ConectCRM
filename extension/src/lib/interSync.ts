// Situação das cobranças do Inter (spec 22): sem servidor para receber os
// avisos (webhooks) do Inter, o CRM consulta. Usado pelo botão "Atualizar
// situação" e pelo service worker (a cada 30 min). Pago → cobrança paga e
// receita "Recebida" na Gestão Financeira; cancelado/expirado → receita excluída.
import type { GfPendingCharge, InterOpenCharge, InterSituacaoChange } from "../db/charges";
import { loadGfSettings, removeLaunch, settleLaunch } from "./finance/gfBridge";
import { getCobranca, type InterCobranca } from "./inter";

type Rpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

/** Baixa pendente porque a receita desta cobrança nunca foi salva na Gestão Financeira. */
export const GF_MISSING_RECEITA = "A receita desta cobrança não está na Gestão Financeira: lance a receita (a baixa vem sozinha em seguida) ou dispense, se ela não vai ser lançada.";

export interface InterSyncResult {
  cobranca: InterCobranca;
  change: InterSituacaoChange;
  /** O que aconteceu na Gestão Financeira (texto para a tela), se algo. */
  gf: string | null;
}

export async function syncInterCharge(rpc: Rpc, c: Pick<InterOpenCharge, "id" | "provider_ref" | "provider_env">): Promise<InterSyncResult> {
  const cob = await getCobranca(c.provider_env, c.provider_ref);
  if (cob.linhaDigitavel || cob.pixCopiaECola) await rpc("charges.interCodes", { id: c.id, barcode: cob.linhaDigitavel, pixCode: cob.pixCopiaECola });
  const receivedCents = cob.valorTotalRecebido != null && Number.isFinite(cob.valorTotalRecebido) ? Math.round(cob.valorTotalRecebido * 100) : null;
  const { change, gf } = await applyInterResult(rpc, c.id, { situacao: cob.situacao, dataSituacao: cob.dataSituacao, receivedCents });
  return { cobranca: cob, change, gf };
}

/** Grava a situação na cobrança e leva a mudança para a Gestão Financeira (modo direto). */
export async function applyInterResult(
  rpc: Rpc,
  id: string,
  r: { situacao: string; dataSituacao?: string | null; receivedCents?: number | null },
): Promise<{ change: InterSituacaoChange; gf: string | null }> {
  const change = await rpc<InterSituacaoChange>("charges.interApply", { id, ...r });
  let gf: string | null = null;
  if (change.changed) {
    const done = await syncGfPending(rpc, { cardId: change.cardId, chargeId: id });
    gf = done[0]?.message ?? null;
  }
  return { change, gf };
}

/**
 * Leva à Gestão Financeira as baixas/exclusões pendentes (cobrança paga antes
 * de a receita ser salva lá, GF fechada…). Repetido pelo service worker até dar
 * certo (ou desistir em 7 dias, com nota no cartão).
 */
export async function syncGfPending(rpc: Rpc, opts: { cardId?: string; chargeId?: string } = {}): Promise<{ id: string; done: boolean; message: string }[]> {
  let list = await rpc<GfPendingCharge[]>("charges.gfPending", opts.cardId ? { cardId: opts.cardId } : {});
  if (opts.chargeId) list = list.filter((c) => c.id === opts.chargeId);
  if (!list.length) return [];
  const s = await loadGfSettings().catch(() => null);
  const out: { id: string; done: boolean; message: string }[] = [];
  for (const c of list) {
    let done = false;
    let message: string;
    if (!s?.gfId || !s.direct) {
      // Sem a Gestão Financeira conectada neste Chrome: nada a fazer aqui.
      done = true;
      message = "";
    } else {
      try {
        if (c.gf_sync === "paid") {
          const x = await settleLaunch(s.gfId, c.card_id, c.order_nsu, true, c.paid_at ? c.paid_at.slice(0, 10) : null);
          done = x.total > 0;
          message = done
            ? "Receita marcada como Recebida na Gestão Financeira."
            : GF_MISSING_RECEITA;
        } else {
          const x = await removeLaunch(s.gfId, c.card_id, c.order_nsu);
          done = true;
          message = x.removed ? "Receita excluída da Gestão Financeira." : x.paid ? "A receita na Gestão Financeira já estava recebida: confira lá." : "";
        }
      } catch (e) {
        message = `A Gestão Financeira não foi atualizada agora (tento de novo em alguns minutos): ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    await rpc("charges.gfSyncResult", { id: c.id, done, error: done ? null : message });
    out.push({ id: c.id, done, message });
  }
  return out;
}
