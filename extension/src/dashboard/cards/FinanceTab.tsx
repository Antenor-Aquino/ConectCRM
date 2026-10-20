// Aba Financeiro do cartão (spec 13, Fase 2): receitas e despesas que a
// Gestão Financeira tem para este cartão. "+ Receita" / "+ Despesa" abrem a
// tela de lançamento de lá, já preenchida (cliente/fornecedor = organização
// do cartão; sem ela, o contato principal). Ao fechar aquela janela, a lista
// é lida de novo. Sem a Gestão Financeira por perto, mostra a última cópia.
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { TaButton, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { CardFinance, FinanceEntry } from "../../db/finance";
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

  const loadLocal = useCallback(async () => {
    setData(await call("finance.card", { id: cardId }));
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

  async function launch(mode: "income" | "expense", edit?: FinanceEntry) {
    setError(null);
    if (!settings?.gfId) return;
    if (!counterparty) {
      setError("Para lançar no financeiro, vincule uma organização ou um contato a este cartão.");
      return;
    }
    const launched = data?.summary.incomeCents ?? 0;
    // Receita: sugere o que falta lançar do valor do cartão.
    const suggested = mode === "income" && valueCents ? Math.max(0, valueCents - launched) : null;
    setOpening(true);
    try {
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
    if (settings?.gfId && settings.direct) void launch("income");
  });

  if (!settings || live === "loading" || counterparty === undefined) return <p className="text-theme-sm text-gray-500">Carregando…</p>;

  if (!settings.gfId) {
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
  const canLaunch = settings.direct && live === "ok";

  return (
    <div className="space-y-3" data-finance-tab>
      <div className="flex flex-wrap items-center gap-2">
        <TaButton size="sm" variant="primary" disabled={!canLaunch || opening} onClick={() => void launch("income")} data-launch="income">
          <TrendingUp size={14} /> Receita
        </TaButton>
        <TaButton size="sm" disabled={!canLaunch || opening} onClick={() => void launch("expense")} data-launch="expense">
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
      {counterparty && canLaunch && (
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
      {live === "off" && <p className="text-theme-xs text-gray-500">Integração direta desligada (Configurações → Integrações). Mostrando a última cópia.</p>}
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
