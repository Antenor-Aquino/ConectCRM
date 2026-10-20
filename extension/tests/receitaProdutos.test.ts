// Produtos e serviços do cartão vão nas observações da receita (Gestão Financeira).
import { describe, expect, it } from "vitest";
import { itemsNotes } from "../src/lib/finance/itemsNotes";
import { PROTOCOL, isIntegrationRequest } from "../src/lib/finance/protocol";
import type { DealItem } from "../src/db/deals";

const item = (p: Partial<DealItem>): DealItem => ({
  id: "i", product_id: null, description: "", quantity: 1, unit_price_cents: 0, discount_cents: 0, total_cents: 0, recurrence: "avulso", ...p,
});
const plain = (s: string | null) => s?.replace(/ /g, " ") ?? null;

describe("observações da receita com os produtos do cartão", () => {
  it("monta descrição, qtd, preço unit., desc. e valor, com o total", () => {
    const text = plain(
      itemsNotes([
        item({ description: "Licenciamento Perseus", recurrence: "mensal", unit_price_cents: 100, total_cents: 100 }),
        item({ description: "Teste", unit_price_cents: 20000, total_cents: 20000 }),
        item({ description: "Implantação", quantity: 2, unit_price_cents: 50000, discount_cents: 10000, total_cents: 90000 }),
      ]),
    );
    expect(text).toBe(
      [
        "Produtos e serviços (ConectCRM):",
        "Descrição | Qtd | Preço unit. | Desc. | Valor",
        "Licenciamento Perseus (Mensal) | 1 | R$ 1,00 | — | R$ 1,00",
        "Teste | 1 | R$ 200,00 | — | R$ 200,00",
        "Implantação | 2 | R$ 500,00 | R$ 100,00 | R$ 900,00",
        "Total: R$ 1.101,00",
      ].join("\n"),
    );
  });

  it("o pedido de lançamento aceita observações (texto) e recusa outro tipo", () => {
    const launch = {
      mode: "income",
      description: "Erro Claudia",
      counterparty: { crmRef: "person:1", kind: "PF", name: "Antenor Aquino" },
      origin: { app: "conectcrm", ref: "c1", label: "Ticket" },
    };
    expect(isIntegrationRequest({ type: "openLaunch", protocol: PROTOCOL, launch: { ...launch, notes: "x" } })).toBe(true);
    expect(isIntegrationRequest({ type: "openLaunch", protocol: PROTOCOL, launch })).toBe(true);
    expect(isIntegrationRequest({ type: "openLaunch", protocol: PROTOCOL, launch: { ...launch, notes: 5 } })).toBe(false);
  });

  it("sem produtos, não sugere observação", () => {
    expect(itemsNotes([])).toBeNull();
  });
});
