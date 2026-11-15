// Banco Inter (spec 22): cobrança Boleto + Pix (API Cobrança v3) e teste de
// conexão (saldo, API Banking v2). Toda chamada passa pelo ConectCRM Fiscal,
// que guarda o certificado da integração (mTLS), o Client Secret e o token —
// nada disso fica no CRM. Aqui só ficam os padrões (ambiente, multa, juros…).
// Documentação: https://developers.inter.co/references/cobranca-bolepix
import { fiscalCall } from "./nfse/fiscal";

export type InterEnv = "sandbox" | "producao";
export const INTER_ENV_LABEL: Record<InterEnv, string> = { sandbox: "Sandbox (testes)", producao: "Produção" };

/** Escopos pedidos num token só (o Inter limita a 5 tokens por minuto). */
export const INTER_SCOPES = "boleto-cobranca.read boleto-cobranca.write extrato.read";

export interface InterSettings {
  env: InterEnv;
  /** Multa após o vencimento (% do valor; 0 = sem multa). */
  finePct: number;
  /** Juros de mora (% ao mês; 0 = sem juros). */
  interestPctMonth: number;
  /** Dias corridos após o vencimento até o Inter cancelar sozinho (0 a 60). */
  cancelAfterDays: number;
  /** Linha de mensagem impressa no boleto (até 78 caracteres). */
  message: string;
}

export const INTER_DEFAULTS: InterSettings = { env: "sandbox", finePct: 2, interestPctMonth: 1, cancelAfterDays: 30, message: "" };
const KEY = "conectcrm-inter";

export async function loadInterSettings(): Promise<InterSettings> {
  const v = (await chrome.storage.local.get(KEY))[KEY] as Partial<InterSettings> | undefined;
  return { ...INTER_DEFAULTS, ...(v ?? {}) };
}
export async function saveInterSettings(s: InterSettings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

export interface InterInfo {
  configured: boolean;
  clientId?: string;
  account?: string;
  subject?: string;
  notAfter?: string;
}

export async function interStatus(env: InterEnv): Promise<InterInfo> {
  const r = (await fiscalCall({ cmd: "interStatus", env })) as unknown as { inter?: InterInfo };
  return r.inter ?? { configured: false };
}

export async function interSetup(env: InterEnv, input: { clientId: string; clientSecret: string; account: string; certPem: string; keyPem: string }): Promise<InterInfo> {
  const r = (await fiscalCall({ cmd: "interSetup", env, ...input })) as unknown as { inter?: InterInfo };
  return r.inter ?? { configured: false };
}

export async function interClear(env: InterEnv): Promise<void> {
  await fiscalCall({ cmd: "interClear", env });
}

export class InterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** Mensagem legível de uma resposta de erro do Inter (title/detail/violacoes). */
export function interErrorMessage(status: number, body: unknown): string {
  const o = (body && typeof body === "object" ? body : {}) as { title?: string; detail?: string; violacoes?: { razao?: string; propriedade?: string; valor?: string }[] };
  const parts = [o.title, o.detail].filter((x): x is string => typeof x === "string" && !!x.trim());
  const v = (o.violacoes ?? []).map((x) => [x.propriedade, x.razao].filter(Boolean).join(": ")).filter(Boolean);
  const txt = [...new Set(parts)].join(" — ") + (v.length ? ` (${v.join("; ")})` : "");
  if (status === 403) return `O Inter recusou (403): confira se a integração tem as permissões de cobrança e extrato${txt ? ` — ${txt}` : ""}.`;
  if (status === 429) return "O Inter pediu para esperar (muitas chamadas por minuto). Tente de novo em 1 minuto.";
  return `O Inter respondeu HTTP ${status}${txt ? `: ${txt}` : ""}.`;
}

type FiscalFn = typeof fiscalCall;

/** Chamada à API do Inter pelo ConectCRM Fiscal; erro HTTP vira InterError. */
export async function interApi<T = unknown>(
  env: InterEnv,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  opts: { query?: Record<string, string>; body?: unknown } = {},
  call: FiscalFn = fiscalCall,
): Promise<T> {
  const query = opts.query ? new URLSearchParams(opts.query).toString() : "";
  const r = (await call({ cmd: "interCall", env, method, path, query, body: opts.body === undefined ? "" : JSON.stringify(opts.body), scopes: INTER_SCOPES })) as unknown as {
    http?: { httpStatus: number; body: string };
  };
  if (!r.http) throw new Error("O ConectCRM Fiscal não devolveu a resposta do Inter. Atualize o ConectCRM Fiscal para a versão 1.1.");
  let body: unknown = null;
  try {
    body = r.http.body ? JSON.parse(r.http.body) : null;
  } catch {
    body = r.http.body;
  }
  if (r.http.httpStatus < 200 || r.http.httpStatus >= 300) throw new InterError(interErrorMessage(r.http.httpStatus, body), r.http.httpStatus, body);
  return body as T;
}

/** Teste de conexão: saldo da conta (certificado, credenciais e permissão de extrato). */
export async function interTestConnection(env: InterEnv, call: FiscalFn = fiscalCall): Promise<{ available: number }> {
  const r = await interApi<{ disponivel?: number }>(env, "GET", "/banking/v2/saldo", {}, call);
  return { available: Number(r?.disponivel ?? 0) };
}

// ---------- Cobrança (Boleto + Pix) ----------

export interface InterPayer {
  kind: "FISICA" | "JURIDICA";
  document: string;
  name: string;
  email: string;
  phone: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

export const emptyPayer = (): InterPayer => ({ kind: "JURIDICA", document: "", name: "", email: "", phone: "", cep: "", street: "", number: "", complement: "", district: "", city: "", state: "" });

/** Valor mínimo de um boleto no Inter. */
export const INTER_MIN_CENTS = 250;

const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

/** O que falta (ou está errado) no pagador para o Inter aceitar. */
export function payerProblems(p: InterPayer): string[] {
  const out: string[] = [];
  const doc = p.document.replace(/\D/g, "");
  if (p.kind === "FISICA" ? doc.length !== 11 : doc.length !== 14) out.push(p.kind === "FISICA" ? "CPF do pagador (11 dígitos)." : "CNPJ do pagador (14 dígitos).");
  if (!p.name.trim()) out.push("Nome do pagador.");
  if (p.cep.replace(/\D/g, "").length !== 8) out.push("CEP do pagador (8 dígitos).");
  if (!p.street.trim()) out.push("Endereço (logradouro) do pagador.");
  if (!p.city.trim()) out.push("Cidade do pagador.");
  if (!UFS.has(p.state.trim().toUpperCase())) out.push("UF do pagador (ex.: PE).");
  if (p.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email.trim())) out.push("E-mail do pagador inválido.");
  return out;
}

/** "Seu número" do boleto (até 15 caracteres, único): C + aammddhhmmss + 2 aleatórios. */
export function newSeuNumero(now = new Date(), rnd = Math.random): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${p(now.getFullYear() % 100)}${p(now.getMonth() + 1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `C${stamp}${p(Math.floor(rnd() * 100))}`;
}

const cut = (s: string, n: number) => s.trim().slice(0, n);

/** Corpo do POST /cobranca/v3/cobrancas. */
export function buildCobranca(input: {
  seuNumero: string;
  amountCents: number;
  dueDate: string;
  payer: InterPayer;
  settings: Pick<InterSettings, "finePct" | "interestPctMonth" | "cancelAfterDays" | "message">;
}): Record<string, unknown> {
  const { payer: p, settings: s } = input;
  const problems = payerProblems(p);
  if (problems.length) throw new Error(`Complete os dados do pagador: ${problems.join(" ")}`);
  if (!Number.isInteger(input.amountCents) || input.amountCents < INTER_MIN_CENTS) throw new Error("O valor mínimo de um boleto no Inter é R$ 2,50.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error("Informe o vencimento.");
  if (input.seuNumero.length > 15) throw new Error("Número do pedido longo demais para o Inter (máx. 15).");
  const days = Math.round(s.cancelAfterDays);
  if (!(days >= 0 && days <= 60)) throw new Error("O cancelamento automático deve ser de 0 a 60 dias após o vencimento.");
  const phone = p.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const body: Record<string, unknown> = {
    seuNumero: input.seuNumero,
    valorNominal: Math.round(input.amountCents) / 100,
    dataVencimento: input.dueDate,
    numDiasAgenda: days,
    pagador: {
      cpfCnpj: p.document.replace(/\D/g, ""),
      tipoPessoa: p.kind,
      nome: cut(p.name, 100),
      endereco: cut(p.street, 100),
      ...(p.number.trim() ? { numero: cut(p.number, 10) } : {}),
      ...(p.complement.trim() ? { complemento: cut(p.complement, 30) } : {}),
      ...(p.district.trim() ? { bairro: cut(p.district, 60) } : {}),
      cidade: cut(p.city, 60),
      uf: p.state.trim().toUpperCase(),
      cep: p.cep.replace(/\D/g, ""),
      ...(p.email.trim() ? { email: cut(p.email, 50) } : {}),
      ...(phone.length >= 10 ? { ddd: phone.slice(0, 2), telefone: phone.slice(2, 11) } : {}),
    },
    formasRecebimento: ["BOLETO", "PIX"],
  };
  if (s.finePct > 0) body.multa = { codigo: "PERCENTUAL", taxa: Math.round(s.finePct * 100) / 100 };
  if (s.interestPctMonth > 0) body.mora = { codigo: "TAXAMENSAL", taxa: Math.round(s.interestPctMonth * 100) / 100 };
  if (s.message.trim()) body.mensagem = { linha1: cut(s.message, 78) };
  return body;
}

export type InterSituacao = "RECEBIDO" | "A_RECEBER" | "MARCADO_RECEBIDO" | "ATRASADO" | "CANCELADO" | "EXPIRADO" | "FALHA_EMISSAO" | "EM_PROCESSAMENTO" | "PROTESTO";

export const SITUACAO_LABEL: Record<InterSituacao, string> = {
  RECEBIDO: "Recebida",
  MARCADO_RECEBIDO: "Marcada como recebida",
  A_RECEBER: "A receber",
  ATRASADO: "Vencida",
  CANCELADO: "Cancelada",
  EXPIRADO: "Expirada",
  FALHA_EMISSAO: "Falha na emissão",
  EM_PROCESSAMENTO: "Em processamento",
  PROTESTO: "Em protesto",
};

/** Situação do Inter → situação da cobrança no CRM. */
export function chargeStatusOf(s: string): "open" | "paid" | "canceled" {
  if (s === "RECEBIDO" || s === "MARCADO_RECEBIDO") return "paid";
  if (s === "CANCELADO" || s === "EXPIRADO" || s === "FALHA_EMISSAO") return "canceled";
  return "open";
}

export interface InterCobranca {
  codigoSolicitacao: string;
  seuNumero: string;
  situacao: InterSituacao;
  dataSituacao: string | null;
  valorNominal: number;
  valorTotalRecebido: number | null;
  linhaDigitavel: string | null;
  codigoBarras: string | null;
  nossoNumero: string | null;
  pixCopiaECola: string | null;
  txid: string | null;
}

/** Resposta do GET /cobrancas/{codigo} → campos usados aqui. */
export function parseCobranca(body: unknown): InterCobranca {
  const o = (body ?? {}) as {
    cobranca?: Record<string, unknown>;
    boleto?: Record<string, unknown>;
    pix?: Record<string, unknown>;
  };
  const c = o.cobranca ?? {};
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    codigoSolicitacao: String(c.codigoSolicitacao ?? ""),
    seuNumero: String(c.seuNumero ?? ""),
    situacao: String(c.situacao ?? "EM_PROCESSAMENTO") as InterSituacao,
    dataSituacao: s(c.dataSituacao),
    valorNominal: Number(c.valorNominal ?? 0),
    valorTotalRecebido: n(c.valorTotalRecebido),
    linhaDigitavel: s(o.boleto?.linhaDigitavel),
    codigoBarras: s(o.boleto?.codigoBarras),
    nossoNumero: s(o.boleto?.nossoNumero),
    pixCopiaECola: s(o.pix?.pixCopiaECola),
    txid: s(o.pix?.txid),
  };
}

export async function getCobranca(env: InterEnv, codigo: string, call: FiscalFn = fiscalCall): Promise<InterCobranca> {
  return parseCobranca(await interApi(env, "GET", `/cobranca/v3/cobrancas/${encodeURIComponent(codigo)}`, {}, call));
}

/**
 * Emite o boleto e espera o Inter terminar de gerar (a emissão é assíncrona:
 * primeiro vem o código da solicitação; linha digitável e Pix chegam depois).
 */
export async function emitCobranca(
  env: InterEnv,
  body: Record<string, unknown>,
  opts: { call?: FiscalFn; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<InterCobranca> {
  const call = opts.call ?? fiscalCall;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const r = await interApi<{ codigoSolicitacao?: string }>(env, "POST", "/cobranca/v3/cobrancas", { body }, call);
  const codigo = r?.codigoSolicitacao;
  if (!codigo) throw new Error("O Inter não devolveu o código da cobrança.");
  const until = Date.now() + (opts.waitMs ?? 30_000);
  let c: InterCobranca = { codigoSolicitacao: codigo, seuNumero: String(body.seuNumero), situacao: "EM_PROCESSAMENTO", dataSituacao: null, valorNominal: Number(body.valorNominal), valorTotalRecebido: null, linhaDigitavel: null, codigoBarras: null, nossoNumero: null, pixCopiaECola: null, txid: null };
  for (let i = 0; ; i++) {
    await sleep(i === 0 ? 1500 : 2500);
    try {
      c = await getCobranca(env, codigo, call);
    } catch (e) {
      // Logo após emitir, a consulta pode ainda não achar a cobrança.
      if (!(e instanceof InterError && e.status === 404)) throw e;
    }
    if ((c.situacao !== "EM_PROCESSAMENTO" && c.linhaDigitavel) || c.situacao === "FALHA_EMISSAO" || Date.now() >= until) break;
  }
  if (!c.codigoSolicitacao) c.codigoSolicitacao = codigo;
  return c;
}

/** PDF do boleto (bytes). */
export async function cobrancaPdf(env: InterEnv, codigo: string, call: FiscalFn = fiscalCall): Promise<Uint8Array> {
  const r = await interApi<{ pdf?: string }>(env, "GET", `/cobranca/v3/cobrancas/${encodeURIComponent(codigo)}/pdf`, {}, call);
  if (!r?.pdf) throw new Error("O Inter não devolveu o PDF do boleto.");
  const bin = atob(r.pdf);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function cancelCobranca(env: InterEnv, codigo: string, reason: string, call: FiscalFn = fiscalCall): Promise<void> {
  const motivo = reason.trim().slice(0, 50) || "Cancelada pelo emissor";
  await interApi(env, "POST", `/cobranca/v3/cobrancas/${encodeURIComponent(codigo)}/cancelar`, { body: { motivoCancelamento: motivo } }, call);
}

/** Sandbox: simula o pagamento (para testar a baixa). */
export async function payCobrancaSandbox(codigo: string, via: "BOLETO" | "PIX" = "PIX", call: FiscalFn = fiscalCall): Promise<void> {
  await interApi("sandbox", "POST", `/cobranca/v3/cobrancas/${encodeURIComponent(codigo)}/pagar`, { body: { pagarCom: via } }, call);
}
