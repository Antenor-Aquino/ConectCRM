// Aba Financeiro do cartão (spec 13, Fase 2): receitas e despesas que a
// Gestão Financeira tem para este cartão. "+ Receita" / "+ Despesa" abrem a
// tela de lançamento de lá, já preenchida (cliente/fornecedor = organização
// do cartão; sem ela, o contato principal). Ao fechar aquela janela, a lista
// é lida de novo. Sem a Gestão Financeira por perto, mostra a última cópia.
// Modo pacote (Fase 4): sem a Gestão Financeira neste Chrome, os botões fazem
// um pedido que vai num arquivo (Configurações → Integrações → Exportar pacote).
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { TaButton, TaInput, TaModal, TaTextarea, cn } from "@tailadmin";
import { MoneyInput } from "../ui/MoneyInput";
import { Field } from "../ui/form";
import { call } from "../../rpc/client";
import type { CardFinance, FinanceEntry, FinanceRequestRow } from "../../db/finance";
import type { LaunchCounterparty } from "../../lib/finance/protocol";
import { GF_ENV_LABEL, listByOrigin, loadGfSettings, openLaunch, type GfSettings } from "../../lib/finance/gfBridge";
import { formatCents, formatDateTime } from "../../lib/format";
import { errorText } from "../../lib/errors";

/** "aaaa-mm-dd" → "dd/mm/aaaa" (sem fuso: é data, não instante). */
const day = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");
const today = () => new Date().toLocaleDateString("sv-SE");

export function FinanceTab({
  cardId,
  title,
  valueCents,
  cardLabel,
  onOpenSettings,
  autoLaunch,
  onAutoLaunchDone,
  onSynced,
}: {
  cardId: string;
  title: string;
  valueCents: number | null;
  /** "Negócio", "Projeto"... (vai no rótulo da origem lá). */
  cardLabel: string;
  onOpenSettings?: () => void;
  /** Abrir já a receita (ex.: ao marcar como ganho). */
  autoLaunch?: boolean;
  onAutoLaunchDone?: () => void;
  /** Cópia local atualizada (a aba mostra a quantidade). */
  onSynced?: () => void;
}) {
  const [settings, setSettings] = useState<GfSettings | null>(null);
  const [data, setData] = useState<CardFinance | null>(null);
  const [counterparty, setCounterparty] = useState<LaunchCounterparty | null | undefined>(undefined);
  const [live, setLive] = useState<"loading" | "ok" | "offline" | "off">("loading");
  const [offlineReason, setOfflineReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const launchWindow = useRef<number | null>(null);
  const [requests, setRequests] = useState<FinanceRequestRow[]>([]);
  const [requestMode, setRequestMode] = useState<"income" | "expense" | null>(null);

  const loadLocal = useCallback(async () => {
    setData(await call("finance.card", { id: cardId }));
    setRequests(await call("finance.requests", { id: cardId }));
  }, [cardId]);

  const refresh = useCallback(async () => {
    const s = await loadGfSettings();
    setSettings(s);
    await loadLocal();
    setCounterparty(await call("finance.cardCounterparty", { id: cardId }));
    if (!s.gfId || !s.direct) {
      setLive("off");
      return;
    }
    try {
      const r = await listByOrigin(s.gfId, [cardId]);
      await call("finance.replace", { dealIds: [cardId], items: r.items, env: r.env, at: r.at });
      await loadLocal();
      onSynced?.();
      setLive("ok");
      setOfflineReason(null);
    } catch (e) {
      setLive("offline");
      setOfflineReason(errorText(e));
    }
  }, [cardId, loadLocal, onSynced]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Janela de lançamento fechada (salvou ou cancelou) ou volta para esta tela: lê de novo.
  useEffect(() => {
    const onRemoved = (id: number) => {
      if (id !== launchWindow.current) return;
      launchWindow.current = null;
      void refresh();
    };
    const onFocus = () => {
      if (launchWindow.current === null) void refresh();
    };
    chrome.windows?.onRemoved.addListener(onRemoved);
    window.addEventListener("focus", onFocus);
    return () => {
      chrome.windows?.onRemoved.removeListener(onRemoved);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Receita: sugere o que falta lançar do valor do cartão (contando os pedidos ainda no pacote).
  const suggestedFor = (mode: "income" | "expense") => {
    if (mode !== "income" || !valueCents) return null;
    const asked = requests.filter((r) => r.request.mode === "income").reduce((a, r) => a + (r.request.amountCents ?? 0), 0);
    return Math.max(0, valueCents - (data?.summary.incomeCents ?? 0) - asked) || null;
  };
  const direct = !!settings?.gfId && settings.direct && live === "ok";
  const packageMode = !!settings?.package && !direct;

  async function launch(mode: "income" | "expense", edit?: FinanceEntry) {
    setError(null);
    if (!counterparty) {
      setError("Para lançar no financeiro, vincule uma organização ou um contato a este cartão.");
      return;
    }
    if (!direct) {
      if (packageMode && !edit) setRequestMode(mode);
      return;
    }
    if (!settings?.gfId) return;
    const suggested = suggestedFor(mode);
    setOpening(true);
    try {
      // A ficha completa vai junto no lançamento; dali em diante, as alterações do cadastro também.
      void call("finance.linkContact", { crmRef: counterparty.crmRef, sent: true });
      launchWindow.current = await openLaunch(settings.gfId, {
        mode,
        description: title,
        amountCents: suggested || null,
        counterparty,
        origin: { app: "conectcrm", ref: cardId, label: `${cardLabel} "${title}" (ConectCRM)` },
        walletId: "empresa",
        editTxId: edit?.id ?? null,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setOpening(false);
    }
  }

  // Abrir a receita direto (pedido ao marcar como ganho), quando já dá.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoLaunch || autoDone.current || live === "loading" || counterparty === undefined) return;
    autoDone.current = true;
    onAutoLaunchDone?.();
    if ((settings?.gfId && settings.direct) || settings?.package) void launch("income");
  });

  if (!settings || live === "loading" || counterparty === undefined) return <p className="text-theme-sm text-gray-500">Carregando…</p>;

  if (!settings.gfId && !settings.package) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-4 text-theme-sm text-gray-600 dark:border-gray-700 dark:text-gray-400" data-finance-setup>
        <p className="mb-2">
          Lance as receitas e despesas deste cartão na <b>Gestão Financeira</b> e acompanhe aqui o resultado.
        </p>
        <p className="mb-3">Para começar, conecte a extensão em Configurações → Integrações → Gestão Financeira.</p>
        {onOpenSettings && (
          <TaButton size="sm" onClick={onOpenSettings}>
            Abrir Integrações
          </TaButton>
        )}
      </div>
    );
  }

  const entries = data?.entries ?? [];
  const s = data?.summary;
  const canLaunch = direct;
  const canAsk = canLaunch || packageMode;

  return (
    <div className="space-y-3" data-finance-tab>
      <div className="flex flex-wrap items-center gap-2">
        <TaButton size="sm" variant="primary" disabled={!canAsk || opening} onClick={() => void launch("income")} data-launch="income">
          <TrendingUp size={14} /> Receita
        </TaButton>
        <TaButton size="sm" disabled={!canAsk || opening} onClick={() => void launch("expense")} data-launch="expense">
          <TrendingDown size={14} /> Despesa
        </TaButton>
        <button
          type="button"
          className="ml-auto flex items-center gap-1 text-theme-xs text-gray-500 hover:text-brand-600"
          onClick={() => void refresh()}
          title="Ler de novo da Gestão Financeira"
        >
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {!counterparty && (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-800" data-finance-no-counterparty>
          Para lançar no financeiro, vincule uma <b>organização</b> ou um <b>contato</b> a este cartão — ele será o cliente/fornecedor do lançamento.
        </p>
      )}
      {counterparty && canAsk && (
        <p className="text-theme-xs text-gray-500">
          Cliente/fornecedor: <b>{counterparty.name}</b> ({counterparty.kind === "PJ" ? "organização do cartão" : "contato principal"})
        </p>
      )}
      {live === "offline" && (
        <p className="rounded-lg bg-gray-100 px-3 py-2 text-theme-xs text-gray-600 dark:bg-white/5 dark:text-gray-400" data-finance-offline>
          A Gestão Financeira não respondeu ({offlineReason}).{" "}
          {data?.syncedAt ? `Mostrando a cópia de ${formatDateTime(data.syncedAt)}.` : "Ainda não há cópia dos lançamentos deste cartão."}
        </p>
      )}
      {packageMode ? (
        <p className="text-theme-xs text-gray-500" data-finance-package-mode>
          Modo pacote: Receita/Despesa fazem um pedido que vai por arquivo (Configurações → Integrações → Gestão Financeira → Exportar pacote).
          {data?.syncedAt && ` Lançamentos conforme o último retorno, de ${formatDateTime(data.syncedAt)}.`}
        </p>
      ) : (
        live === "off" && <p className="text-theme-xs text-gray-500">Integração direta desligada (Configurações → Integrações). Mostrando a última cópia.</p>
      )}
      {data?.env === "demo" && (
        <p className="rounded-lg bg-warning-50 px-3 py-2 text-theme-xs text-warning-800">A Gestão Financeira está no {GF_ENV_LABEL.demo}: estes valores não são os reais.</p>
      )}
      {error && <p className="text-theme-sm text-error-600">{error}</p>}

      {s && entries.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-theme-xs" data-finance-summary>
          <Stat label="Receitas" value={s.incomeCents} sub={`recebido ${formatCents(s.incomePaidCents)}`} tone="success" />
          <Stat label="Despesas" value={s.expenseCents} sub={`pago ${formatCents(s.expensePaidCents)}`} tone="error" />
          <Stat label="Resultado" value={s.resultCents} sub={`realizado ${formatCents(s.resultPaidCents)}`} tone={s.resultCents >= 0 ? "success" : "error"} />
        </div>
      )}

      {requests.length > 0 && (
        <div data-finance-requests>
          <p className="mb-1 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Pedidos no pacote (ainda não lançados)</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-dashed border-gray-300 dark:divide-gray-800 dark:border-gray-700">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-theme-sm" data-finance-request={r.status}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-gray-800 dark:text-white/90">{r.request.description}</span>
                  <span className="block text-theme-xs text-gray-500">
                    {r.request.dueDate ? `venc. ${day(r.request.dueDate)} · ` : ""}
                    {r.status === "pending" ? "aguardando exportação" : `exportado em ${formatDateTime(r.exportedAt)} · aguardando o retorno`}
                  </span>
                </span>
                <span className={cn("whitespace-nowrap text-theme-sm font-semibold", r.request.mode === "income" ? "text-success-600" : "text-error-600")}>
                  {r.request.mode === "income" ? "+" : "−"} {r.request.amountCents ? formatCents(r.request.amountCents) : "valor a definir"}
                </span>
                <button
                  type="button"
                  className="text-theme-xs text-gray-400 hover:text-error-600"
                  title="Desistir do pedido"
                  onClick={() => {
                    if (r.status === "exported" && !confirm("Este pedido já foi exportado. Se já foi lançado na Gestão Financeira, exclua lá também. Desistir dele aqui?")) return;
                    void call("finance.requestDiscard", { id: r.id }).then(loadLocal);
                  }}
                >
                  Desistir
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {requestMode && (
        <RequestModal
          mode={requestMode}
          title={title}
          suggestedCents={suggestedFor(requestMode)}
          onClose={() => setRequestMode(null)}
          onSave={async (input) => {
            await call("finance.requestCreate", { dealId: cardId, ...input });
            setRequestMode(null);
            await loadLocal();
          }}
        />
      )}

      {entries.length === 0 ? (
        <p className="text-theme-sm text-gray-500">Nenhum lançamento na Gestão Financeira para este cartão.</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800" data-finance-list>
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/5"
                disabled={!canLaunch}
                title={canLaunch ? "Abrir na Gestão Financeira" : undefined}
                onClick={() => void launch(e.type, e)}
                data-finance-entry={e.type}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-theme-sm text-gray-800 dark:text-white/90">
                    {e.description}
                    {e.installmentTotal && e.installmentTotal > 1 && !/\(\d+\/\d+\)/.test(e.description) ? ` (${e.installmentNumber}/${e.installmentTotal})` : ""}
                  </div>
                  <div className="truncate text-theme-xs text-gray-500">
                    {[e.code, `venc. ${day(e.dueDate ?? e.competenceDate)}`, e.category && (e.subcategory ? `${e.category} › ${e.subcategory}` : e.category), e.costCenter, e.creditCard ?? e.account]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <StatusChip entry={e} />
                <span className={cn("whitespace-nowrap text-theme-sm font-semibold", e.type === "income" ? "text-success-600" : "text-error-600")}>
                  {e.type === "income" ? "+" : "−"} {formatCents(e.amountCents)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: "success" | "error" }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
      <div className="text-gray-500">{label}</div>
      <div className={cn("text-theme-sm font-semibold", tone === "success" ? "text-success-600" : "text-error-600")}>{formatCents(value)}</div>
      <div className="text-gray-400">{sub}</div>
    </div>
  );
}

function StatusChip({ entry }: { entry: FinanceEntry }) {
  const paid = entry.status === "paid";
  const late = !paid && (entry.dueDate ?? entry.competenceDate) < today();
  const label = paid ? (entry.type === "income" ? `Recebido ${day(entry.paymentDate)}` : `Pago ${day(entry.paymentDate)}`) : late ? "Atrasado" : "Em aberto";
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        paid ? "bg-success-50 text-success-700" : late ? "bg-error-50 text-error-700" : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400",
      )}
    >
      {label}
    </span>
  );
}

/** Pedido de lançamento para o pacote (a Gestão Financeira completa categoria, conta etc. ao importar). */
function RequestModal({
  mode,
  title,
  suggestedCents,
  onClose,
  onSave,
}: {
  mode: "income" | "expense";
  title: string;
  suggestedCents: number | null;
  onClose: () => void;
  onSave: (input: { mode: "income" | "expense"; description: string; amountCents: number | null; dueDate: string | null; competenceDate: string | null; notes: string | null }) => Promise<void>;
}) {
  const [description, setDescription] = useState(title);
  const [amount, setAmount] = useState(suggestedCents ?? 0);
  const [dueDate, setDueDate] = useState(today());
  const [competenceDate, setCompetenceDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const income = mode === "income";
  return (
    <TaModal isOpen onClose={onClose} title={income ? "Pedido de receita" : "Pedido de despesa"} accent={income ? "var(--color-success-500)" : "var(--color-error-500)"}>
      <div data-finance-request-modal>
        <p className="mb-3 text-theme-xs text-gray-500">
          Vai no próximo pacote para a Gestão Financeira. Lá você confere e completa categoria, projeto e conta ao importar.
        </p>
        <Field label="Descrição" required>
          <TaInput value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Descrição do pedido" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Valor">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Vencimento">
            <TaInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Competência">
            <TaInput type="date" value={competenceDate} onChange={(e) => setCompetenceDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Observação">
          <TaTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && <p className="mb-2 text-theme-sm text-error-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <TaButton onClick={onClose}>Cancelar</TaButton>
          <TaButton
            variant="primary"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              setError(null);
              onSave({ mode, description, amountCents: amount > 0 ? amount : null, dueDate: dueDate || null, competenceDate: competenceDate || null, notes: notes.trim() || null })
                .catch((e: unknown) => setError(errorText(e)))
                .finally(() => setSaving(false));
            }}
          >
            Guardar pedido
          </TaButton>
        </div>
      </div>
    </TaModal>
  );
}
