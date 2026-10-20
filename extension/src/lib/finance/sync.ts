// Leitura geral dos lançamentos da Gestão Financeira (spec 13, Fase 3): usada
// por Relatórios → Financeiro e pelo financeiro do cliente. Atualiza a cópia
// local; sem a Gestão Financeira por perto, as telas usam a última cópia.
import { call } from "../../rpc/client";
import { errorText } from "../errors";
import { listAllFromCrm, loadGfSettings, pushPendingContactsVia } from "./gfBridge";

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

export type ContactsPushResult =
  | { status: "ok"; sent: number; failed: { crmRef: string; message: string }[] }
  | { status: "package" }
  | { status: "off" }
  | { status: "offline"; message: string };

/**
 * Paridade de cadastros: manda para a Gestão Financeira os contatos e
 * organizações alterados no CRM. Modo direto: na hora; modo pacote: ficam para
 * o próximo pacote. Não lança erro.
 */
export async function pushPendingContacts(): Promise<ContactsPushResult> {
  const s = await loadGfSettings();
  if (s.gfId && s.direct) {
    try {
      const r = await pushPendingContactsVia(s.gfId, { pending: () => call("finance.pendingContacts"), sent: (crmRefs) => call("finance.contactsSent", { crmRefs }) });
      return { status: "ok", ...r };
    } catch (e) {
      return s.package ? { status: "package" } : { status: "offline", message: errorText(e) };
    }
  }
  return s.package ? { status: "package" } : { status: "off" };
}
