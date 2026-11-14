// "Cobrança" do cartão (spec 21): gera o link de pagamento no checkout da
// InfinitePay com os produtos e serviços do cartão e, em seguida, abre a
// receita na Gestão Financeira já preenchida (valor, vencimento, link).
import { useEffect, useState } from "react";
import { Check, Copy, CreditCard, ExternalLink, Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import { TaBadge, TaButton, TaInput, TaModal } from "@tailadmin";
import { call } from "../../rpc/client";
import { brl, chargeTotal, MIN_CHARGE_CENTS, type Charge, type ChargeDraft, type ChargeItem } from "../../db/charges";
import { buildLinkPayload, createPaymentLink, loadInfinitePay, normalizeHandle, requestInfinitePayPermission, saveInfinitePay } from "../../lib/infinitepay";
import { errorText } from "../../lib/errors";
import { formatCents } from "../../lib/format";
import { MoneyInput } from "../ui/MoneyInput";
import { Field } from "../ui/form";
import type { LaunchPreset } from "./FinanceTab";

const today = () => new Date().toLocaleDateString("sv-SE");
const day = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const STATUS: Record<Charge["status"], { label: string; color: "amber" | "green" | "slate" }> = {
  open: { label: "Aguardando pagamento", color: "amber" },
  paid: { label: "Paga", color: "green" },
  canceled: { label: "Cancelada", color: "slate" },
};

/** Observações da receita na Gestão Financeira. */
export function chargeNotes(c: { url: string; orderNsu: string; items: ChargeItem[] }): string {
  return [
    "Cobrança InfinitePay (link de pagamento)",
    `Link: ${c.url}`,
    `Pedido: ${c.orderNsu}`,
    "",
    ...c.items.map((i) => `- ${i.quantity} × ${i.description} — ${brl(i.priceCents * i.quantity)}`),
  ].join("\n");
}

export function ChargeDialog({
  cardId,
  gfActive,
  onClose,
  onChanged,
  onLaunchFinance,
}: {
  cardId: string;
  /** Gestão Financeira conectada (direto ou por pacote). */
  gfActive: boolean;
  onClose: () => void;
  onChanged?: () => void;
  /** Abre a receita na Gestão Financeira (aba Financeiro do cartão). */
  onLaunchFinance: (preset: LaunchPreset) => void;
}) {
  const [draft, setDraft] = useState<ChargeDraft | null>(null);
  const [items, setItems] = useState<ChargeItem[]>([]);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [dueDate, setDueDate] = useState(today());
  const [handle, setHandle] = useState("");
  const [editHandle, setEditHandle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; preset: LaunchPreset } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async (resetForm: boolean) => {
    try {
      const d = await call("charges.draft", { id: cardId });
      setDraft(d);
      if (resetForm) {
        setItems(d.items);
        setCustomer({ name: d.customer.name ?? "", email: d.customer.email ?? "", phone: d.customer.phone ?? "" });
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void load(true);
    void loadInfinitePay().then((s) => setHandle(s.handle));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = chargeTotal(items);
  const setItem = (i: number, patch: Partial<ChargeItem>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const problems = [
    !items.length && "Inclua pelo menos um item.",
    items.some((i) => !i.description.trim()) && "Todo item precisa de descrição.",
    items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1) && "Quantidade precisa ser um número inteiro (1, 2, 3…).",
    items.some((i) => i.priceCents <= 0) && "Todo item precisa de valor.",
    total < MIN_CHARGE_CENTS && "O valor mínimo de uma cobrança na InfinitePay é R$ 1,00.",
    !normalizeHandle(handle) && "Informe a InfiniteTag da conta InfinitePay.",
  ].filter(Boolean) as string[];

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const generate = async () => {
    // 1º, ainda dentro do clique: a permissão do site da InfinitePay (1º uso).
    const permission = requestInfinitePayPermission();
    setError(null);
    if (!(await permission.catch(() => false))) {
      setError("Sem a permissão de acesso à InfinitePay não dá para gerar o link. Clique em Gerar cobrança de novo e escolha Permitir.");
      return;
    }
    if (!draft) return;
    if (!confirm(`Gerar a cobrança de ${formatCents(total)} na InfinitePay ($${normalizeHandle(handle)})?`)) return;
    setBusy(true);
    try {
      await saveInfinitePay({ handle });
      const orderNsu = await call("charges.newOrderNsu", { id: cardId });
      const clean = items.map((i) => ({ ...i, description: i.description.trim() }));
      const payload = buildLinkPayload(handle, orderNsu, clean, {
        name: customer.name.trim() || null,
        email: customer.email.trim() || null,
        phone: customer.phone.trim() || null,
      });
      const { url } = await createPaymentLink(payload);
      const description = `Cobrança InfinitePay — ${draft.cardTitle}`.slice(0, 200);
      await call("charges.save", { id: cardId, handle: payload.handle, orderNsu, url, items: clean, description, dueDate });
      const preset: LaunchPreset = { description, amountCents: total, notes: chargeNotes({ url, orderNsu, items: clean }), dueDate };
      setCreated({ url, preset });
      await load(false);
      onChanged?.();
      // A receita correspondente: abre já preenchida na Gestão Financeira.
      if (gfActive) onLaunchFinance(preset);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (c: Charge, status: Charge["status"]) => {
    const q =
      status === "paid"
        ? `Marcar a cobrança de ${formatCents(c.amount_cents)} como paga?\n\nConfira o pagamento no app ou na Conta Web da InfinitePay (Suas vendas → Checkout integrado). Dê baixa também na receita da Gestão Financeira.`
        : status === "canceled"
          ? `Cancelar a cobrança de ${formatCents(c.amount_cents)} no CRM?\n\nA InfinitePay não permite desativar um link já criado: se o cliente pagar mesmo assim, estorne pelo app ou pela Conta Web.`
          : "Reabrir esta cobrança?";
    if (!confirm(q)) return;
    try {
      await call("charges.setStatus", { id: c.id, status });
      await load(false);
      onChanged?.();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <TaModal isOpen onClose={onClose} title="Cobrança (InfinitePay)" width="max-w-3xl">
      <div className="space-y-4 text-theme-sm text-gray-700 dark:text-gray-300" data-charge-dialog>
        {!draft ? (
          error ? <p className="rounded-lg bg-error-50 px-3 py-2 text-error-700">{error}</p> : <p className="text-gray-500">Carregando…</p>
        ) : (
          <>
            {created && (
              <div className="rounded-xl border border-success-200 bg-success-50 p-3 text-success-800 dark:bg-success-500/10" data-charge-created>
                <p className="flex items-center gap-2 font-semibold">
                  <Check size={16} /> Cobrança gerada: {formatCents(created.preset.amountCents)}
                </p>
                <p className="mt-1 break-all text-theme-xs" data-charge-url>
                  {created.url}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <TaButton size="sm" variant="outline" startIcon={copied === "new" ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy(created.url, "new")} data-charge-copy>
                    {copied === "new" ? "Copiado" : "Copiar link"}
                  </TaButton>
                  <a className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300" href={created.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> Abrir
                  </a>
                  {gfActive && (
                    <TaButton size="sm" variant="outline" startIcon={<Wallet size={14} />} onClick={() => onLaunchFinance(created.preset)} data-charge-launch>
                      Abrir a receita na Gestão Financeira
                    </TaButton>
                  )}
                </div>
                <p className="mt-2 text-theme-xs">
                  {gfActive
                    ? "A receita foi aberta na Gestão Financeira já preenchida (valor, vencimento, cliente e o link nas observações): confira a categoria e a conta e salve."
                    : "Conecte a Gestão Financeira (Configurações → Integrações) para lançar a receita desta cobrança."}{" "}
                  O link também ficou nas notas do cartão.
                </p>
              </div>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-theme-xs font-semibold uppercase text-gray-500">Itens da cobrança</p>
                <TaButton size="sm" variant="ghost" startIcon={<Plus size={14} />} onClick={() => setItems((l) => [...l, { description: "", quantity: 1, priceCents: 0 }])} data-charge-add-item>
                  Item
                </TaButton>
              </div>
              {items.length === 0 && <p className="text-theme-xs text-gray-500">O cartão não tem produtos/serviços nem valor. Inclua um item.</p>}
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_130px_auto] items-center gap-2" data-charge-item>
                    <TaInput value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Descrição" aria-label="Descrição do item" maxLength={200} />
                    <TaInput
                      value={String(it.quantity)}
                      onChange={(e) => setItem(i, { quantity: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                      inputMode="numeric"
                      aria-label="Quantidade"
                    />
                    <MoneyInput value={it.priceCents} onChange={(c) => setItem(i, { priceCents: c })} />
                    <button type="button" className="text-gray-400 hover:text-error-600" title="Tirar item" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-right text-theme-sm">
                Total: <b data-charge-total>{formatCents(total)}</b>
              </p>
            </section>

            <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Cliente (vem preenchido no pagamento)">
                <TaInput value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} aria-label="Nome do cliente" />
              </Field>
              <Field label="E-mail">
                <TaInput value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} aria-label="E-mail do cliente" />
              </Field>
              <Field label="Celular (+55…)">
                <TaInput value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} aria-label="Celular do cliente" />
              </Field>
              <Field label="Vencimento da receita">
                <TaInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-charge-due />
              </Field>
              <Field label="Conta InfinitePay (InfiniteTag)">
                {editHandle ? (
                  <TaInput value={handle} onChange={(e) => setHandle(e.target.value)} onBlur={() => setEditHandle(false)} autoFocus data-charge-handle />
                ) : (
                  <p className="py-2">
                    <b>${normalizeHandle(handle)}</b>{" "}
                    <button type="button" className="text-theme-xs text-brand-600 hover:underline" onClick={() => setEditHandle(true)}>
                      alterar
                    </button>
                  </p>
                )}
              </Field>
            </section>

            {problems.length > 0 && (
              <ul className="list-disc rounded-lg bg-warning-50 py-2 pl-7 pr-3 text-theme-xs text-warning-700" data-charge-problems>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {error && (
              <p className="rounded-lg bg-error-50 px-3 py-2 text-error-700" data-charge-error>
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-theme-xs text-gray-500">
                Pix ou cartão (até 12x). O pagamento é avisado na InfinitePay; aqui você dá baixa em “Marcar como paga”.
              </p>
              <TaButton
                startIcon={busy ? <RefreshCw size={15} className="animate-spin" /> : <CreditCard size={15} />}
                disabled={busy || problems.length > 0}
                onClick={() => void generate()}
                data-charge-generate
              >
                {busy ? "Gerando…" : created ? "Gerar outra cobrança" : "Gerar cobrança"}
              </TaButton>
            </div>

            {draft.charges.length > 0 && (
              <section data-charge-list>
                <p className="mb-2 text-theme-xs font-semibold uppercase text-gray-500">Cobranças deste cartão</p>
                <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {draft.charges.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-charge-row={c.status}>
                      <span className="font-medium">{formatCents(c.amount_cents)}</span>
                      <TaBadge color={STATUS[c.status].color} label={STATUS[c.status].label} />
                      <span className="text-theme-xs text-gray-500">
                        gerada em {day(c.created_at)}
                        {c.due_date ? ` · vence ${day(c.due_date)}` : ""}
                        {c.paid_at ? ` · paga em ${day(c.paid_at)}` : ""}
                      </span>
                      <span className="ml-auto flex gap-1">
                        <TaButton size="sm" variant="ghost" startIcon={copied === c.id ? <Check size={13} /> : <Copy size={13} />} onClick={() => void copy(c.url, c.id)}>
                          {copied === c.id ? "Copiado" : "Link"}
                        </TaButton>
                        {c.status === "open" && (
                          <>
                            <TaButton size="sm" variant="ghost" onClick={() => void setStatus(c, "paid")} data-charge-paid>
                              Marcar como paga
                            </TaButton>
                            <TaButton size="sm" variant="ghost" onClick={() => void setStatus(c, "canceled")}>
                              Cancelar
                            </TaButton>
                          </>
                        )}
                        {c.status !== "open" && (
                          <TaButton size="sm" variant="ghost" onClick={() => void setStatus(c, "open")}>
                            Reabrir
                          </TaButton>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </TaModal>
  );
}
