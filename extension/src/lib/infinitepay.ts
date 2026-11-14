// Checkout integrado da InfinitePay (spec 21): cria links de pagamento.
// Documentação: https://www.infinitepay.io/checkout-documentacao
// - POST https://api.checkout.infinitepay.io/links { handle, items[{description, quantity, price(centavos)}], order_nsu, customer }
//   Sem API Key: a handle (InfiniteTag sem "$") basta para criar o link.
// - POST https://api.checkout.infinitepay.io/payment_check { handle, order_nsu, transaction_nsu, slug }
// Não há sandbox: cada link criado é real (só vira venda se alguém pagar).
import type { ChargeCustomer, ChargeItem } from "../db/charges";

export const INFINITEPAY_API = "https://api.checkout.infinitepay.io";
export const INFINITEPAY_ORIGIN = `${INFINITEPAY_API}/*`;
const STORAGE_KEY = "conectcrm-infinitepay";
/** Conta informada pelo dono do projeto ($claudiatech). */
export const DEFAULT_HANDLE = "claudiatech";

export interface InfinitePaySettings {
  /** InfiniteTag sem o "$". */
  handle: string;
  /** Nome da empresa na nota da cobrança ("Cobrança Claudia Tecnologia gerada"). */
  company: string;
}

export const DEFAULT_COMPANY = "Claudia Tecnologia";

/** "$ClaudiaTech " → "ClaudiaTech" (a InfinitePay pede exatamente a tag, sem "$" e sem espaços). */
export const normalizeHandle = (v: string) => v.trim().replace(/^\$/, "").replace(/\s+/g, "");

export async function loadInfinitePay(): Promise<InfinitePaySettings> {
  const v = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<InfinitePaySettings> | undefined;
  return { handle: normalizeHandle(v?.handle || DEFAULT_HANDLE), company: v?.company?.trim() || DEFAULT_COMPANY };
}

export async function saveInfinitePay(s: InfinitePaySettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: { handle: normalizeHandle(s.handle), company: s.company.trim() || DEFAULT_COMPANY } });
}

/**
 * Permissão para falar com a API (1º uso). Precisa ser a 1ª chamada dentro do
 * clique (o Chrome exige o gesto do usuário).
 */
export function requestInfinitePayPermission(): Promise<boolean> {
  if (!chrome.permissions?.request) return Promise.resolve(true);
  return chrome.permissions.request({ origins: [INFINITEPAY_ORIGIN] });
}

export interface LinkPayload {
  handle: string;
  items: { description: string; quantity: number; price: number }[];
  order_nsu: string;
  customer?: { name?: string; email?: string; phone_number?: string };
}

/** Corpo do POST /links. Cliente só com os campos que existem. */
export function buildLinkPayload(handle: string, orderNsu: string, items: ChargeItem[], customer?: ChargeCustomer | null): LinkPayload {
  const h = normalizeHandle(handle);
  if (!h) throw new Error("Informe a InfiniteTag da conta InfinitePay.");
  if (!items.length) throw new Error("A cobrança precisa de pelo menos um item.");
  const p: LinkPayload = {
    handle: h,
    items: items.map((i) => {
      if (!Number.isInteger(i.priceCents) || i.priceCents <= 0) throw new Error(`Preço inválido em "${i.description}".`);
      if (!Number.isInteger(i.quantity) || i.quantity <= 0) throw new Error(`Quantidade inválida em "${i.description}".`);
      return { description: i.description.slice(0, 200), quantity: i.quantity, price: i.priceCents };
    }),
    order_nsu: orderNsu,
  };
  const c: NonNullable<LinkPayload["customer"]> = {};
  if (customer?.name) c.name = customer.name;
  if (customer?.email) c.email = customer.email;
  if (customer?.phone) c.phone_number = customer.phone;
  if (Object.keys(c).length) p.customer = c;
  return p;
}

/** URL do link na resposta: a documentação não fixa o nome do campo (url, checkout_url, link…). */
export function linkUrlFromResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  for (const k of ["url", "checkout_url", "link", "payment_url", "link_url"]) {
    const v = o[k];
    if (typeof v === "string" && /^https:\/\//.test(v)) return v;
  }
  for (const v of Object.values(o)) {
    if (typeof v === "string" && /^https:\/\/\S+$/.test(v)) return v;
    if (v && typeof v === "object") {
      const inner = linkUrlFromResponse(v);
      if (inner) return inner;
    }
  }
  return null;
}

/** Mensagem de erro legível da resposta da API. */
export function infinitePayError(status: number, body: unknown, text: string): string {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const raw = [o.code, o.error, o.message, o.detail].filter((v) => typeof v === "string").join(" — ") || text.slice(0, 300);
  if (/external_checkout_not_enabled|not enabled/i.test(raw))
    return "O checkout integrado não está ligado nesta conta InfinitePay. No app ou na Conta Web: Configurações do Checkout → Habilitar checkout integrado. Confira também a InfiniteTag.";
  if (status === 403) return "A InfinitePay recusou (403): confira se a InfiniteTag é a da sua conta.";
  return `A InfinitePay respondeu HTTP ${status}${raw ? `: ${raw}` : ""}.`;
}

/** Cria o link de pagamento. */
export async function createPaymentLink(payload: LinkPayload, fetchFn: typeof fetch = fetch): Promise<{ url: string; raw: unknown }> {
  let res: Response;
  try {
    res = await fetchFn(`${INFINITEPAY_API}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(`Sem conexão com a InfinitePay (${e instanceof Error ? e.message : String(e)}).`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(infinitePayError(res.status, body, text));
  const url = linkUrlFromResponse(body) ?? (/^https:\/\/\S+$/.test(text.trim()) ? text.trim() : null);
  if (!url) throw new Error(`A InfinitePay não devolveu o link. Resposta: ${text.slice(0, 300)}`);
  return { url, raw: body };
}
