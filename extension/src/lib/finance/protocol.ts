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
  /** Pedido do CRM (modo pacote) que gerou o lançamento. */
  requestId?: string | null;
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

// ---------- Modo pacote (arquivo), para quando as duas extensões não estão no mesmo Chrome ----------

export const PACKAGE_FORMAT = "conectcrm-gestao-financeira";

/** Pedido de lançamento feito no CRM, levado por arquivo. */
export interface PackageRequest extends LaunchRequest {
  id: string;
  dueDate?: string | null;
  competenceDate?: string | null;
  notes?: string | null;
  createdAt: string;
  createdBy?: string | null;
}

/** CRM → Gestão Financeira: pedidos de lançamento. */
export interface RequestsPackage {
  format: typeof PACKAGE_FORMAT;
  version: 1;
  kind: "requests";
  createdAt: string;
  from: { app: "conectcrm"; version: string };
  requests: PackageRequest[];
}

/** Gestão Financeira → CRM: todos os lançamentos vindos do CRM (o CRM substitui a cópia dele). */
export interface ReturnPackage {
  format: typeof PACKAGE_FORMAT;
  version: 1;
  kind: "return";
  createdAt: string;
  from: { app: "gestao-financeira"; version: string };
  env: GfEnv;
  items: FinanceItem[];
}

/** Lê um pacote (texto do arquivo); lança erro com mensagem para o usuário. */
export function parsePackage(text: string): RequestsPackage | ReturnPackage {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("Arquivo inválido: não é um pacote da integração ConectCRM ↔ Gestão Financeira.");
  }
  const p = v as { format?: string; version?: number; kind?: string; requests?: unknown[]; items?: Partial<FinanceItem>[] } | null;
  if (!p || p.format !== PACKAGE_FORMAT) throw new Error("Arquivo inválido: não é um pacote da integração ConectCRM ↔ Gestão Financeira.");
  if (p.version !== 1) throw new Error("Pacote de uma versão mais nova. Atualize esta extensão.");
  if (p.kind === "requests") {
    if (!Array.isArray(p.requests) || !p.requests.every((r) => isLaunchRequest(r) && typeof (r as PackageRequest).id === "string"))
      throw new Error("Pacote com pedidos inválidos.");
    return p as unknown as RequestsPackage;
  }
  if (p.kind === "return") {
    if (!Array.isArray(p.items) || !p.items.every((i) => i && typeof i.id === "string" && typeof i.ref === "string" && (i.type === "income" || i.type === "expense") && typeof i.amountCents === "number"))
      throw new Error("Pacote de retorno inválido.");
    return p as unknown as ReturnPackage;
  }
  throw new Error("Tipo de pacote desconhecido.");
}
