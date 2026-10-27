// Configurações → Produtos e serviços: catálogo usado em "Adicionar produtos"
// dos negócios, com categorias.
import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaModal, TaPanel, TaSelect, TaTextarea, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { RECURRENCE_LABEL, RECURRENCES, type Product, type ProductKind, type Recurrence } from "../../db/products";
import { formatCents } from "../../lib/format";
import { useSession } from "../session";
import { ErrorText, Field } from "../ui/form";
import { MoneyInput } from "../ui/MoneyInput";
import { Switch } from "../ui/Switch";
import { errorText } from "../../lib/errors";
import { CustomFieldsForm } from "../ui/CustomFieldsForm";
import type { CustomField, CustomValue } from "../../db/customFields";


export function ProductsSettings() {
  const { user } = useSession();
  const canEdit = user.role === "admin" || user.role === "gestor";
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProducts(await call("products.list", { search, includeInactive: true }));
    setCategories(await call("productCategories.list"));
    setUsage(await call("products.usage"));
  }, [search]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TaPanel
      title="Produtos e serviços"
      subtitle="Catálogo usado em “Adicionar” (produtos e serviços) nos cartões de todos os funis."
      action={
        canEdit && (
          <span className="flex gap-2">
            <TaButton onClick={() => setCatOpen(true)}>Categorias</TaButton>
            <TaButton variant="primary" startIcon={<Plus size={15} />} onClick={() => setEditing("new")}>
              Novo produto/serviço
            </TaButton>
          </span>
        )
      }
    >
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
        <TaInput className="pl-9" placeholder="Pesquisar por nome ou código" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <p className="mb-3 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      {products.length === 0 ? (
        <p className="py-6 text-center text-theme-sm text-gray-500">Nenhum produto ou serviço cadastrado.</p>
      ) : (
        <table className="w-full text-left text-theme-sm">
          <thead className="text-theme-xs uppercase text-gray-500">
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="py-2 pr-3 font-medium">Código</th>
              <th className="py-2 pr-3 font-medium">Nome</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 text-right font-medium">Preço</th>
              <th className="py-2 pr-3 font-medium">Recorrência</th>
              <th className="py-2 pr-3 font-medium">Categoria</th>
              <th className="py-2 pr-3 font-medium">Uso</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className={cn("border-b border-gray-100 dark:border-gray-800", !p.active && "opacity-50")}>
                <td className="py-2.5 pr-3 font-mono text-theme-xs text-gray-500">{p.code ?? "—"}</td>
                <td className="py-2.5 pr-3 font-medium text-gray-800 dark:text-white/90">
                  {p.name}
                  {p.name_ext && <span className="font-normal text-gray-500" data-name-ext> - {p.name_ext}</span>} {!p.active && <TaBadge color="amber" label="Inativo" />}
                </td>
                <td className="py-2.5 pr-3">
                  <TaBadge color={p.kind === "produto" ? "blue" : "purple"} label={p.kind === "produto" ? "Produto" : "Serviço"} />
                </td>
                <td className="py-2.5 pr-3 text-right">
                  {formatCents(p.price_cents)}
                  {p.unit && <span className="text-theme-xs text-gray-400"> /{p.unit}</span>}
                </td>
                <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">{RECURRENCE_LABEL[p.recurrence]}</td>
                <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-400">{categories.find((c) => c.id === p.category_id)?.name ?? "—"}</td>
                <td className="py-2.5 pr-3 text-theme-xs text-gray-500">{usage[p.id] ?? 0} negócio(s)</td>
                <td className="py-2.5 text-right">
                  {canEdit && (
                    <span className="flex justify-end gap-2 text-gray-400">
                      <button type="button" title="Editar" className="hover:text-brand-600" onClick={() => setEditing(p)}>
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        className="hover:text-error-600"
                        onClick={async () => {
                          const n = usage[p.id] ?? 0;
                          if (!confirm(n ? `"${p.name}" está em ${n} negócio(s); os itens continuam neles. Excluir do catálogo? Vai para a lixeira, de onde pode ser restaurado.` : `Excluir "${p.name}"? Vai para a lixeira, de onde pode ser restaurado.`)) return;
                          try {
                            await call("products.delete", { id: p.id });
                            await load();
                          } catch (e) {
                            setError(errorText(e));
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <ProductModal
          product={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {catOpen && <CategoriesModal categories={categories} onClose={() => setCatOpen(false)} onChanged={load} />}
    </TaPanel>
  );
}

function ProductModal({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(product?.code ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [kind, setKind] = useState<ProductKind>(product?.kind ?? "servico");
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [price, setPrice] = useState(product?.price_cents ?? 0);
  const [cost, setCost] = useState(product?.cost_cents ?? 0);
  const [recurrence, setRecurrence] = useState<Recurrence>(product?.recurrence ?? "avulso");
  const [categoryId, setCategoryId] = useState(product?.category_id ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [active, setActive] = useState(product ? !!product.active : true);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, CustomValue>>({});
  useEffect(() => {
    void call("customFields.list", { entity: "product" }).then(setFields);
    if (product) void call("products.customValues", { id: product.id }).then(setValues);
  }, [product]);

  async function save() {
    const input = { code, name, kind, unit, priceCents: price, costCents: cost || null, recurrence, categoryId: categoryId || null, description, active, customValues: values };
    try {
      if (product) await call("products.update", { id: product.id, patch: input });
      else await call("products.create", input);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <TaModal isOpen onClose={onClose} title={product ? "Editar produto/serviço" : "Novo produto/serviço"}>
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <Field label="Código">
          <TaInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex.: LIC-01" />
        </Field>
        <Field label="Nome" required>
          <TaInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <TaSelect value={kind} onChange={(e) => setKind(e.target.value as ProductKind)}>
            <option value="servico">Serviço</option>
            <option value="produto">Produto</option>
          </TaSelect>
        </Field>
        <Field label="Unidade">
          <TaInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Ex.: licença, hora, un" />
        </Field>
        <Field label="Preço">
          <MoneyInput value={price} onChange={setPrice} />
        </Field>
        <Field label="Custo" hint="Opcional; usado em relatórios de margem.">
          <MoneyInput value={cost} onChange={setCost} />
        </Field>
        <Field label="Recorrência">
          <TaSelect value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {RECURRENCE_LABEL[r]}
              </option>
            ))}
          </TaSelect>
        </Field>
        <Field label="Categoria">
          <TaSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </TaSelect>
        </Field>
      </div>
      <Field label="Descrição">
        <TaTextarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <CustomFieldsForm fields={fields} values={values} onChange={setValues} columns={2} />
      <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-theme-sm font-medium dark:border-gray-800">
        Ativo (aparece em “Adicionar” nos cartões)
        <Switch checked={active} onChange={setActive} />
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="mt-5 flex justify-end gap-2">
        <TaButton onClick={onClose}>Cancelar</TaButton>
        <TaButton variant="primary" onClick={() => void save()}>
          Salvar
        </TaButton>
      </div>
    </TaModal>
  );
}

function CategoriesModal({ categories, onClose, onChanged }: { categories: { id: string; name: string }[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <TaModal isOpen onClose={onClose} title="Categorias de produtos">
      <div className="mb-3 flex gap-2">
        <TaInput placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} />
        <TaButton variant="primary" disabled={!name.trim()} onClick={() => void run(async () => {
          await call("productCategories.create", { name });
          setName("");
        })}>
          Adicionar
        </TaButton>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <TaInput defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && void run(() => call("productCategories.rename", { id: c.id, name: e.target.value }))} />
            <button type="button" title="Excluir" className="text-gray-400 hover:text-error-600" onClick={() => confirm(`Excluir a categoria "${c.name}"? Vai para a lixeira, de onde pode ser restaurado.`) && void run(() => call("productCategories.delete", { id: c.id }))}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
        {categories.length === 0 && <p className="py-2 text-theme-sm text-gray-400">Nenhuma categoria.</p>}
      </ul>
      <ErrorText>{error}</ErrorText>
    </TaModal>
  );
}
