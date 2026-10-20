// Protocolo entre ConectCRM e Gestão Financeira (mensagens entre extensões,
// chrome.runtime.sendMessage(idDaOutra, ...)). O MESMO arquivo existe nos
// dois repositórios: ao mudar aqui, copie para o outro e suba PROTOCOL.
//
// Segurança: nenhuma das duas aceita mensagem de quem não foi pareado. O
// pareamento começa no ConectCRM ("hello") e só vale depois que o usuário
// clica em Permitir na Gestão Financeira.
export const PROTOCOL = 2;

/**
 * Ficha de contato (pessoa física) ou organização (pessoa jurídica) do
 * ConectCRM, com tudo o que vai para "Clientes e fornecedores" da Gestão
 * Financeira. PARIDADE: ao mudar o cadastro de contatos/organizações em um
 * dos sistemas, atualize esta ficha (e CONTACT_CARD_FIELDS) nos DOIS
 * repositórios — os testes de paridade de cada lado conferem (ver CLAUDE.md).
 */
export interface ContactCard {
  /** "organization:<id>" ou "person:<id>" (vínculo estável com o CRM). */
  crmRef: string;
  kind: "PF" | "PJ";
  /** PF: nome; PJ: nome fantasia. */
  name: string;
  /** CPF (PF) ou CNPJ (PJ), só dígitos. */
  document?: string | null;
  email?: string | null;
  /** E.164 (+5511999998888). */
  phone?: string | null;
  /** País do telefone (ISO, ex.: BR). */
  phoneCountry?: string | null;
  /** PJ */
  legalName?: string | null;
  website?: string | null;
  segment?: string | null;
  address?: {
    cep?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  } | null;
  /** PF: empresa onde trabalha (organização principal no CRM). */
  company?: { crmRef: string; name: string } | null;
  /** Observações (PF) ou descrição (PJ) do CRM. */
  notes?: string | null;
  tags?: string[];
  /** Campos personalizados visíveis, já formatados ("Cargo: Diretora"). */
  customFields?: { label: string; value: string }[];
}

/** Versão da ficha (sobe quando um campo novo entra). */
export const CONTACT_CARD_VERSION = 1;

/** Todos os campos da ficha — os testes de paridade dos dois sistemas usam esta lista. */
export const CONTACT_CARD_FIELDS = [
  "crmRef",
  "kind",
  "name",
  "document",
  "email",
  "phone",
  "phoneCountry",
  "legalName",
  "website",
  "segment",
  "address.cep",
  "address.street",
  "address.number",
  "address.complement",
  "address.district",
  "address.city",
  "address.state",
  "address.country",
  "company.crmRef",
  "company.name",
  "notes",
  "tags",
  "customFields",
] as const;

export type ContactCardField = (typeof CONTACT_CARD_FIELDS)[number];

/** Cliente/fornecedor do lançamento: a ficha completa. */
export type LaunchCounterparty = ContactCard;

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
  /** Cria/atualiza em "Clientes e fornecedores" os contatos e organizações do CRM (o CRM manda nos dados vinculados). */
  | { type: "upsertContacts"; protocol: number; contacts: ContactCard[] }
  /** Lançamentos destes cartões (ids do CRM); sem `refs`, todos os lançamentos vindos do CRM. */
  | { type: "listByOrigin"; protocol: number; refs?: string[] };

export type GfEnv = "production" | "demo";

export type IntegrationResponse =
  | { ok: true; status: "paired"; app: "gestao-financeira"; version: string; protocol: number; env: GfEnv }
  | { ok: true; status: "pending" | "refused" }
  | { ok: true; status: "opened"; windowId: number | null }
  | { ok: true; status: "contacts"; created: number; updated: number; failed: { crmRef: string; message: string }[] }
  | { ok: true; status: "items"; items: FinanceItem[]; env: GfEnv; at: string }
  | { ok: false; error: "not-paired" | "invalid" | "protocol"; message?: string };

export function isIntegrationRequest(v: unknown): v is IntegrationRequest {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  if (m.type === "ping") return typeof m.protocol === "number";
  if (m.type === "upsertContacts")
    return typeof m.protocol === "number" && Array.isArray(m.contacts) && m.contacts.length <= 500 && m.contacts.every(isContactCard);
  if (m.type === "openLaunch") return typeof m.protocol === "number" && isLaunchRequest(m.launch);
  if (m.type === "listByOrigin")
    return typeof m.protocol === "number" && (m.refs === undefined || (Array.isArray(m.refs) && m.refs.length <= 500 && m.refs.every((r) => typeof r === "string")));
  if (m.type === "hello") return m.app === "conectcrm" && typeof m.appVersion === "string" && typeof m.protocol === "number";
  return false;
}

export function isContactCard(v: unknown): v is ContactCard {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.crmRef === "string" && c.crmRef !== "" && (c.kind === "PF" || c.kind === "PJ") && typeof c.name === "string" && c.name.trim() !== "";
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
    isContactCard(cp) &&
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
  /** Contatos e organizações alterados no CRM (ou enviados pelo botão) desde o último pacote. */
  contacts?: ContactCard[];
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
  const p = v as { format?: string; version?: number; kind?: string; requests?: unknown[]; contacts?: unknown; items?: Partial<FinanceItem>[] } | null;
  if (!p || p.format !== PACKAGE_FORMAT) throw new Error("Arquivo inválido: não é um pacote da integração ConectCRM ↔ Gestão Financeira.");
  if (p.version !== 1) throw new Error("Pacote de uma versão mais nova. Atualize esta extensão.");
  if (p.kind === "requests") {
    if (!Array.isArray(p.requests) || !p.requests.every((r) => isLaunchRequest(r) && typeof (r as PackageRequest).id === "string"))
      throw new Error("Pacote com pedidos inválidos.");
    if (p.contacts !== undefined && !(Array.isArray(p.contacts) && p.contacts.every(isContactCard))) throw new Error("Pacote com contatos inválidos.");
    return p as unknown as RequestsPackage;
  }
  if (p.kind === "return") {
    if (!Array.isArray(p.items) || !p.items.every((i) => i && typeof i.id === "string" && typeof i.ref === "string" && (i.type === "income" || i.type === "expense") && typeof i.amountCents === "number"))
      throw new Error("Pacote de retorno inválido.");
    return p as unknown as ReturnPackage;
  }
  throw new Error("Tipo de pacote desconhecido.");
}
