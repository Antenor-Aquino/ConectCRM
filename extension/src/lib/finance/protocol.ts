// Protocolo entre ConectCRM e Gestão Financeira (mensagens entre extensões,
// chrome.runtime.sendMessage(idDaOutra, ...)). O MESMO arquivo existe nos
// dois repositórios: ao mudar aqui, copie para o outro e suba PROTOCOL.
//
// Segurança: nenhuma das duas aceita mensagem de quem não foi pareado. O
// pareamento começa no ConectCRM ("hello") e só vale depois que o usuário
// clica em Permitir na Gestão Financeira.
export const PROTOCOL = 2;

/** Cliente/fornecedor do lançamento, como está no ConectCRM. */
export interface LaunchCounterparty {
  /** "organization:<id>" ou "person:<id>" (vínculo estável com o CRM). */
  crmRef: string;
  kind: "PF" | "PJ";
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Pedido para abrir a tela de lançamento da Gestão Financeira já preenchida. */
export interface LaunchRequest {
  mode: "income" | "expense";
  description: string;
  amountCents?: number | null;
  counterparty: LaunchCounterparty;
  /** De onde vem (cartão do CRM): os lançamentos ficam ligados a ele. */
  origin: { app: "conectcrm"; ref: string; label: string };
  /** Carteira sugerida (padrão: Empresa). */
  walletId?: string | null;
  /** Abrir um lançamento já feito por este cartão para editar. */
  editTxId?: string | null;
}

/** Lançamento da Gestão Financeira ligado a um registro do CRM. */
export interface FinanceItem {
  id: string;
  code: string | null;
  /** origin_ref (id do cartão no CRM). */
  ref: string;
  type: "income" | "expense";
  status: "pending" | "paid";
  description: string;
  amountCents: number;
  competenceDate: string;
  dueDate: string | null;
  paymentDate: string | null;
  category: string | null;
  subcategory: string | null;
  costCenter: string | null;
  costSubcenter: string | null;
  counterparty: string | null;
  wallet: string | null;
  account: string | null;
  creditCard: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
}

export type IntegrationRequest =
  /** ConectCRM pede para se conectar (ou confere se já está conectado). */
  | { type: "hello"; app: "conectcrm"; appName: string; appVersion: string; protocol: number }
  /** Teste de conexão. */
  | { type: "ping"; protocol: number }
  /** Abre a janela de lançamento (receita/despesa) preenchida. */
  | { type: "openLaunch"; protocol: number; launch: LaunchRequest }
  /** Lançamentos destes cartões (ids do CRM); sem `refs`, todos os lançamentos vindos do CRM. */
  | { type: "listByOrigin"; protocol: number; refs?: string[] };

export type GfEnv = "production" | "demo";

export type IntegrationResponse =
  | { ok: true; status: "paired"; app: "gestao-financeira"; version: string; protocol: number; env: GfEnv }
  | { ok: true; status: "pending" | "refused" }
  | { ok: true; status: "opened"; windowId: number | null }
  | { ok: true; status: "items"; items: FinanceItem[]; env: GfEnv; at: string }
  | { ok: false; error: "not-paired" | "invalid" | "protocol"; message?: string };

export function isIntegrationRequest(v: unknown): v is IntegrationRequest {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  if (m.type === "ping") return typeof m.protocol === "number";
  if (m.type === "openLaunch") return typeof m.protocol === "number" && isLaunchRequest(m.launch);
  if (m.type === "listByOrigin")
    return typeof m.protocol === "number" && (m.refs === undefined || (Array.isArray(m.refs) && m.refs.length <= 500 && m.refs.every((r) => typeof r === "string")));
  if (m.type === "hello") return m.app === "conectcrm" && typeof m.appVersion === "string" && typeof m.protocol === "number";
  return false;
}

function isLaunchRequest(v: unknown): v is LaunchRequest {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  const cp = l.counterparty as Record<string, unknown> | undefined;
  const o = l.origin as Record<string, unknown> | undefined;
  return (
    (l.mode === "income" || l.mode === "expense") &&
    typeof l.description === "string" &&
    (l.amountCents == null || (typeof l.amountCents === "number" && Number.isFinite(l.amountCents) && l.amountCents >= 0)) &&
    !!cp && typeof cp.crmRef === "string" && (cp.kind === "PF" || cp.kind === "PJ") && typeof cp.name === "string" && cp.name.trim() !== "" &&
    !!o && o.app === "conectcrm" && typeof o.ref === "string" && o.ref !== "" && typeof o.label === "string"
  );
}
