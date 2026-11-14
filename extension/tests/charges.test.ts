// Cobrança InfinitePay (spec 21): itens do cartão, pedido à API e registro no CRM.
import { describe, expect, it, vi } from "vitest";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCard, setDealItems } from "../src/db/deals";
import { chargeDraftForCard, chargeItemsFromCard, chargePhone, listCharges, newOrderNsu, saveCharge, setChargeStatus } from "../src/db/charges";
import { createPipeline } from "../src/db/pipelines";
import { createProduct } from "../src/db/products";
import { createUser } from "../src/db/users";
import { many } from "../src/db/sql";
import { buildLinkPayload, createPaymentLink, infinitePayError, linkUrlFromResponse, normalizeHandle } from "../src/lib/infinitepay";
import { chargeNotes } from "../src/dashboard/cards/ChargeDialog";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pc = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const org = createOrganization(db, ctx, { name: "Caixa Escolar Prof. Hildebrando Pontes", email: "escola@educacao.mg.gov.br" });
  const person = createPerson(db, ctx, { name: "Cristiane Souza", email: "cris@escola.br", phone: "(34) 99999-1234", organizationIds: [org] });
  const card = createCard(db, ctx, { pipelineId: pc, title: "Certificado digital A1", organizationId: org, personId: person });
  const a1 = createProduct(db, ctx, { name: "Certificado A1", kind: "servico" });
  setDealItems(db, ctx, card, [
    { productId: a1, description: "Certificado digital A1", quantity: 2, unitPriceCents: 2600 },
    { description: "Instalação", quantity: 1.5, unitPriceCents: 1000 },
    { description: "Brinde", quantity: 1, unitPriceCents: 0 },
  ]);
  return { db, ctx, card, org };
}

describe("Cobrança — itens e comprador", () => {
  it("telefone no formato da InfinitePay", () => {
    expect(chargePhone("(87) 99999-0000")).toBe("+5587999990000");
    expect(chargePhone("+55 87 3861-0000")).toBe("+558738610000");
    expect(chargePhone("12345")).toBeNull();
    expect(chargePhone(null)).toBeNull();
  });

  it("itens do cartão: quantidade inteira mantém preço unitário; fracionada ou com desconto vira 1 × total; zerado sai", () => {
    expect(
      chargeItemsFromCard([
        { description: "A", quantity: 2, unit_price_cents: 2600, discount_cents: 0, total_cents: 5200 },
        { description: "B", quantity: 1.5, unit_price_cents: 1000, discount_cents: 0, total_cents: 1500 },
        { description: "C", quantity: 1, unit_price_cents: 1000, discount_cents: 100, total_cents: 900 },
        { description: "D", quantity: 1, unit_price_cents: 0, discount_cents: 0, total_cents: 0 },
      ]),
    ).toEqual([
      { description: "A", quantity: 2, priceCents: 2600 },
      { description: "B", quantity: 1, priceCents: 1500 },
      { description: "C", quantity: 1, priceCents: 900 },
    ]);
  });

  it("rascunho do cartão: itens, total e comprador (contato principal)", async () => {
    const { db, card } = await setup();
    const d = chargeDraftForCard(db, card);
    expect(d.totalCents).toBe(6700);
    expect(d.items).toHaveLength(2);
    expect(d.customer).toEqual({ name: "Cristiane Souza", email: "cris@escola.br", phone: "+5534999991234" });
    expect(d.charges).toEqual([]);
  });
});

describe("Cobrança — InfinitePay", () => {
  it("pedido do link: handle sem $, preço em centavos, cliente só com o que existe", () => {
    expect(normalizeHandle(" $claudiatech ")).toBe("claudiatech");
    const p = buildLinkPayload("$claudiatech", "crm-abc-261114", [{ description: "Certificado", quantity: 2, priceCents: 2600 }], { name: "Cris", email: null, phone: "+5534999991234" });
    expect(p).toEqual({
      handle: "claudiatech",
      items: [{ description: "Certificado", quantity: 2, price: 2600 }],
      order_nsu: "crm-abc-261114",
      customer: { name: "Cris", phone_number: "+5534999991234" },
    });
    expect(buildLinkPayload("x", "n", [{ description: "a", quantity: 1, priceCents: 100 }], { name: null, email: null, phone: null }).customer).toBeUndefined();
    expect(() => buildLinkPayload("", "n", [{ description: "a", quantity: 1, priceCents: 100 }])).toThrow(/InfiniteTag/);
    expect(() => buildLinkPayload("x", "n", [{ description: "a", quantity: 1.5, priceCents: 100 }])).toThrow(/Quantidade/);
  });

  it("URL do link em qualquer campo da resposta", () => {
    expect(linkUrlFromResponse({ url: "https://checkout.infinitepay.io/claudiatech/abc" })).toBe("https://checkout.infinitepay.io/claudiatech/abc");
    expect(linkUrlFromResponse({ checkout_url: "https://checkout.infinitepay.io/x" })).toBe("https://checkout.infinitepay.io/x");
    expect(linkUrlFromResponse({ data: { link: "https://pay.infinitepay.io/y" } })).toBe("https://pay.infinitepay.io/y");
    expect(linkUrlFromResponse({ ok: true })).toBeNull();
  });

  it("chama POST /links e devolve o link; erros com mensagem clara", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ url: "https://checkout.infinitepay.io/claudiatech/xyz" }), { status: 200 }));
    const payload = buildLinkPayload("claudiatech", "n1", [{ description: "a", quantity: 1, priceCents: 100 }]);
    expect((await createPaymentLink(payload, ok as unknown as typeof fetch)).url).toBe("https://checkout.infinitepay.io/claudiatech/xyz");
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.checkout.infinitepay.io/links");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(payload);
    const off = vi.fn(async () => new Response(JSON.stringify({ code: "external_checkout_not_enabled", message: "External checkout is not enabled for this merchant" }), { status: 422 }));
    await expect(createPaymentLink(payload, off as unknown as typeof fetch)).rejects.toThrow(/Habilitar checkout integrado/);
    expect(infinitePayError(403, null, "")).toMatch(/InfiniteTag/);
    const net = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(createPaymentLink(payload, net as unknown as typeof fetch)).rejects.toThrow(/Sem conexão/);
  });
});

describe("Cobrança — registro no CRM", () => {
  it("grava, deixa nota no cartão, lista e muda o status", async () => {
    const { db, ctx, card } = await setup();
    const nsu = newOrderNsu(card, new Date("2026-11-14T21:00:05Z"));
    expect(nsu).toMatch(/^crm-[0-9a-zA-Z]{1,8}-261114210005$/);
    const items = [{ description: "Certificado digital A1", quantity: 2, priceCents: 2600 }];
    expect(() => saveCharge(db, ctx, card, { handle: "claudiatech", orderNsu: nsu, url: "http://x", items, description: "d" })).toThrow(/Link/);
    expect(() => saveCharge(db, ctx, card, { handle: "claudiatech", orderNsu: nsu, url: "https://x", items: [{ description: "a", quantity: 1, priceCents: 50 }], description: "d" })).toThrow(/R\$ 1,00/);
    const id = saveCharge(db, ctx, card, { handle: "claudiatech", orderNsu: nsu, url: "https://checkout.infinitepay.io/claudiatech/xyz", items, description: "Cobrança InfinitePay — Certificado", dueDate: "2026-11-20" });
    const [c] = listCharges(db, card);
    expect(c).toMatchObject({ id, amount_cents: 5200, status: "open", due_date: "2026-11-20", items });
    const note = many<{ body: string }>(db, "SELECT body FROM note WHERE entity_id = ? ORDER BY created_at", card).at(-1)!.body;
    expect(note).toBe(
      `Cobrança InfinitePay gerada:\nValor: R$ 52,00\nVencimento 20/11/2026\nItem: 2 × Certificado digital A1\nLink de pagamento: https://checkout.infinitepay.io/claudiatech/xyz\nPedido: ${nsu}`,
    );
    setChargeStatus(db, ctx, id, "paid");
    expect(listCharges(db, card)[0]).toMatchObject({ status: "paid" });
    expect(listCharges(db, card)[0]!.paid_at).not.toBeNull();
    setChargeStatus(db, ctx, id, "open");
    expect(listCharges(db, card)[0]).toMatchObject({ status: "open", paid_at: null });
    expect(chargeDraftForCard(db, card).charges).toHaveLength(1);
  });

  it("texto da nota no formato pedido (empresa, valor, vencimento, item, link, pedido)", async () => {
    const { chargeNoteText } = await import("../src/db/charges");
    expect(
      chargeNoteText({
        company: "Claudia Tecnologia",
        amountCents: 5200,
        dueDate: "2026-11-14",
        items: [{ description: "Certificado A3 - 24 meses", quantity: 1, priceCents: 5200 }],
        url: "https://checkout.infinitepay.io/claudiatech?lenc=abc",
        orderNsu: "crm-0ef2b6bc-261114222659",
      }),
    ).toBe(
      "Cobrança Claudia Tecnologia gerada:\nValor: R$ 52,00\nVencimento 14/11/2026\nItem: Certificado A3 - 24 meses\nLink de pagamento: https://checkout.infinitepay.io/claudiatech?lenc=abc\nPedido: crm-0ef2b6bc-261114222659",
    );
    // Vários itens e sem vencimento.
    expect(
      chargeNoteText({ company: "Claudia Tecnologia", amountCents: 7000, items: [{ description: "A", quantity: 2, priceCents: 2500 }, { description: "B", quantity: 1, priceCents: 2000 }], url: "https://l", orderNsu: "n" }),
    ).toBe("Cobrança Claudia Tecnologia gerada:\nValor: R$ 70,00\nItens:\n- 2 × A\n- B\nLink de pagamento: https://l\nPedido: n");
  });

  it("observações da receita na Gestão Financeira", () => {
    expect(chargeNotes({ url: "https://l", orderNsu: "n1", items: [{ description: "Certificado", quantity: 2, priceCents: 2600 }] })).toBe(
      "Cobrança InfinitePay (link de pagamento)\nLink: https://l\nPedido: n1\n\n- 2 × Certificado — R$ 52,00",
    );
  });
});
