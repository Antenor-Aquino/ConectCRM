// Produtos e serviços do cartão como texto para as observações do lançamento
// na Gestão Financeira (descrição | qtd | preço unit. | desc. | valor).
import type { DealItem } from "../../db/deals";
import { RECURRENCE_LABEL } from "../../db/products";
import { formatCents } from "../format";

export function itemsNotes(items: DealItem[]): string | null {
  if (!items.length) return null;
  const qty = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const lines = items.map((i) => {
    const name = i.recurrence && i.recurrence !== "avulso" ? `${i.description} (${RECURRENCE_LABEL[i.recurrence]})` : i.description;
    return [name, qty(i.quantity), formatCents(i.unit_price_cents), i.discount_cents ? formatCents(i.discount_cents) : "—", formatCents(i.total_cents)].join(" | ");
  });
  const total = items.reduce((a, i) => a + i.total_cents, 0);
  return ["Produtos e serviços (ConectCRM):", "Descrição | Qtd | Preço unit. | Desc. | Valor", ...lines, `Total: ${formatCents(total)}`].join("\n");
}
