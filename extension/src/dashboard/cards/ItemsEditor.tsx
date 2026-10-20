// "Adicionar produtos": itens do negócio (produto do catálogo ou descrição
// livre), quantidade, preço, desconto e total. O valor do negócio vira a soma.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { TaButton, TaInput, TaModal, TaSelect } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Product } from "../../db/products";
import type { DealItemInput } from "../../db/deals";
import { formatCents } from "../../lib/format";
import { MoneyInput } from "../ui/MoneyInput";

export interface ItemDraft extends DealItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
}

export const itemTotal = (i: ItemDraft) => Math.max(0, Math.round(i.quantity * i.unitPriceCents) - i.discountCents);

const GRID = "grid grid-cols-[1fr_70px_120px_110px_100px_28px] items-center gap-2";
const emptyRow = (): ItemDraft => ({ description: "", quantity: 1, unitPriceCents: 0, discountCents: 0 });

export function ItemsEditor({
  open,
  items,
  onClose,
  onSave,
}: {
  open: boolean;
  items: ItemDraft[];
  onClose: () => void;
  onSave: (items: ItemDraft[]) => void;
}) {
  const [rows, setRows] = useState<ItemDraft[]>(items);
  const [products, setProducts] = useState<Product[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShowErrors(false);
    setRows(items.length ? items : [emptyRow()]);
    void call("products.list", {}).then(setProducts);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (i: number, patch: Partial<ItemDraft>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  // Linha totalmente vazia é ignorada; com preço, desconto ou produto, a descrição é obrigatória.
  const blank = (r: ItemDraft) => !r.description.trim() && !r.productId && r.unitPriceCents === 0 && r.discountCents === 0;
  const filled = rows.filter((r) => !blank(r));
  const missing = (r: ItemDraft) => !blank(r) && !r.description.trim();
  const apply = () => {
    if (filled.some(missing)) return setShowErrors(true);
    onSave(filled);
  };

  return (
    <TaModal isOpen={open} onClose={onClose} title="Produtos e serviços" width="max-w-3xl">
      <div className={`${GRID} text-theme-xs font-medium text-gray-500`}>
        <span>Produto / serviço</span>
        <span>Qtd.</span>
        <span>Preço unit.</span>
        <span>Desconto</span>
        <span className="text-right">Total</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className={`${GRID} mt-2`}>
          <div className="flex gap-1">
            {products.length > 0 && (
              <TaSelect
                className="w-32 shrink-0"
                value={row.productId ?? ""}
                onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  update(i, p ? { productId: p.id, description: p.name, unitPriceCents: p.price_cents, recurrence: p.recurrence } : { productId: null });
                }}
              >
                <option value="">Avulso</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.name_ext && <span className="font-normal text-gray-500" data-name-ext> - {p.name_ext}</span>}
                  </option>
                ))}
              </TaSelect>
            )}
            <TaInput
              placeholder={showErrors && missing(row) ? "Informe a descrição" : "Descrição"}
              value={row.description}
              onChange={(e) => update(i, { description: e.target.value })}
              aria-invalid={showErrors && missing(row)}
              className={showErrors && missing(row) ? "border-error-500 placeholder:text-error-500 focus:border-error-500 focus:ring-error-500/10" : undefined}
            />
          </div>
          <TaInput type="number" min={0} step="any" value={row.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) || 0 })} />
          <MoneyInput value={row.unitPriceCents} onChange={(c) => update(i, { unitPriceCents: c })} />
          <MoneyInput value={row.discountCents} onChange={(c) => update(i, { discountCents: c })} />
          <span className="text-right text-theme-sm font-medium text-gray-800 dark:text-white/90">{formatCents(itemTotal(row))}</span>
          <button type="button" title="Remover" className="text-gray-400 hover:text-error-600" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {showErrors && filled.some(missing) && (
        <p className="mt-2 text-theme-sm text-error-600" role="alert">
          Preencha a descrição dos itens destacados para aplicar.
        </p>
      )}
      <TaButton variant="ghost" className="mt-2" startIcon={<Plus size={14} />} onClick={() => setRows((r) => [...r, emptyRow()])}>
        Adicionar item
      </TaButton>
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 dark:border-gray-800">
        <span className="text-theme-sm text-gray-600 dark:text-gray-300">
          Total: <strong>{formatCents(filled.reduce((acc, r) => acc + itemTotal(r), 0))}</strong>
        </span>
        <div className="flex gap-2">
          <TaButton onClick={onClose}>Cancelar</TaButton>
          <TaButton variant="primary" onClick={apply}>
            Aplicar
          </TaButton>
        </div>
      </div>
    </TaModal>
  );
}
