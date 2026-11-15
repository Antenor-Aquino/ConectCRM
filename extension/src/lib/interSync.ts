// Situação das cobranças do Inter (spec 22): sem servidor para receber os
// avisos (webhooks) do Inter, o CRM consulta. Usado pelo botão "Atualizar
// situação" e pelo service worker (a cada 30 min). Pago → cobrança paga e
// receita "Recebida" na Gestão Financeira; cancelado/expirado → receita excluída.
import type { InterOpenCharge, InterSituacaoChange } from "../db/charges";
import { loadGfSettings, removeLaunch, settleLaunch } from "./finance/gfBridge";
import { getCobranca, type InterCobranca } from "./inter";

type Rpc = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

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
    const s = await loadGfSettings().catch(() => null);
    if (s?.gfId && s.direct) {
      try {
        if (change.to === "paid") {
          const x = await settleLaunch(s.gfId, change.cardId, change.orderNsu, true, change.paidDate);
          gf = x.total ? "Receita marcada como Recebida na Gestão Financeira." : "Não achei a receita desta cobrança na Gestão Financeira.";
        } else if (change.to === "canceled") {
          const x = await removeLaunch(s.gfId, change.cardId, change.orderNsu);
          gf = x.removed ? "Receita excluída da Gestão Financeira." : x.paid ? "A receita na Gestão Financeira já estava recebida: confira lá." : null;
        }
      } catch (e) {
        gf = `A Gestão Financeira não foi atualizada: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  return { change, gf };
}
