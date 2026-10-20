// Leitura geral dos lançamentos da Gestão Financeira (spec 13, Fase 3): usada
// por Relatórios → Financeiro e pelo financeiro do cliente. Atualiza a cópia
// local; sem a Gestão Financeira por perto, as telas usam a última cópia.
import { call } from "../../rpc/client";
import { errorText } from "../errors";
import { listAllFromCrm, loadGfSettings } from "./gfBridge";

export type FinanceSyncResult = { status: "ok"; at: string } | { status: "off" } | { status: "offline"; message: string };

/** Lê tudo da Gestão Financeira e grava a cópia; não lança erro. */
export async function syncAllFinance(): Promise<FinanceSyncResult> {
  const s = await loadGfSettings();
  if (!s.gfId || !s.direct) return { status: "off" };
  try {
    const r = await listAllFromCrm(s.gfId, () => call("finance.cardIds"));
    await call("finance.replaceAll", { items: r.items, env: r.env, at: r.at });
    return { status: "ok", at: r.at };
  } catch (e) {
    return { status: "offline", message: errorText(e) };
  }
}
