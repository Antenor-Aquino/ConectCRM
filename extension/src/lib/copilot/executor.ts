// Liga cada ferramenta do Copiloto à consulta no banco (RPC ao documento
// offscreen, com a permissão do usuário atual).
import { call } from "../../rpc/client";
import type { ToolExecutor } from "./agent";
import { syncAllFinance } from "../finance/sync";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

export const rpcExecutor: ToolExecutor = async (name, a) => {
  switch (name) {
    case "buscar_cartoes":
      return call("copilot.searchCards", {
        texto: str(a.texto),
        status: (["open", "won", "lost", "all"] as const).find((s) => s === a.status),
        funil: str(a.funil),
        responsavel: str(a.responsavel),
        limite: num(a.limite),
      });
    case "detalhar_cartao":
      return call("copilot.card", { id: String(a.id ?? "") });
    case "resumo_comercial":
      return call("copilot.summary", { de: String(a.de ?? ""), ate: String(a.ate ?? ""), funil: str(a.funil), responsavel: str(a.responsavel) });
    case "listar_tarefas":
      return call("copilot.tasks", {
        situacao: (["atrasadas", "hoje", "proximos_7_dias", "pendentes"] as const).find((s) => s === a.situacao),
        responsavel: str(a.responsavel),
      });
    case "negocios_parados":
      return call("copilot.stale", { dias: num(a.dias), funil: str(a.funil), responsavel: str(a.responsavel) });
    case "buscar_contatos":
      return call("copilot.contacts", { texto: String(a.texto ?? "") });
    case "resumo_financeiro":
      await syncAllFinance();
      return call("copilot.finance", {
        de: String(a.de ?? ""),
        ate: String(a.ate ?? ""),
        base: (["competencia", "vencimento", "caixa"] as const).find((b) => b === a.base),
        funil: str(a.funil),
        responsavel: str(a.responsavel),
      });
    case "pendencias_financeiras":
      await syncAllFinance();
      return call("copilot.financeAlerts", { responsavel: str(a.responsavel) });
    case "estrutura_do_crm":
      return call("copilot.structure");
    default:
      return { erro: `Ferramenta desconhecida: ${name}` };
  }
};
