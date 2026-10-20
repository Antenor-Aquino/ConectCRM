// Financeiro do cliente (spec 13, Fase 3): na organização (ou no contato),
// o que foi lançado na Gestão Financeira pelos cartões dele — receitas,
// despesas, resultado, o que falta receber e o resultado de cada cartão.
import { useEffect, useState } from "react";
import { cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { ClientFinance } from "../../db/finance";
import { formatCents, formatDateTime } from "../../lib/format";
import { syncAllFinance, type FinanceSyncResult } from "../../lib/finance/sync";

const day = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

export function ClientFinancePanel({
  filter,
  onOpenCard,
}: {
  filter: { organizationId?: string; personId?: string };
  onOpenCard: (pipelineId: string, cardId: string) => void;
}) {
  const [data, setData] = useState<ClientFinance | null>(null);
  const [sync, setSync] = useState<FinanceSyncResult | null>(null);
  const key = filter.organizationId ?? filter.personId;

  useEffect(() => {
    let alive = true;
    const load = () => call("finance.client", filter).then((d) => alive && setData(d));
    // Mostra a cópia na hora; lê da Gestão Financeira e atualiza.
    void load();
    void syncAllFinance().then((s) => {
      if (!alive) return;
      setSync(s);
      if (s.status === "ok") void load();
    });
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-theme-sm text-gray-500">Carregando…</p>;
  const t = data.totals;
  const today = new Date().toLocaleDateString("sv-SE");
  return (
    <div className="space-y-3" data-client-finance>
      {sync?.status === "package" && (
        <p className="text-theme-xs text-gray-500">
          Modo pacote: valores conforme o último retorno importado da Gestão Financeira{data.syncedAt ? ` (${formatDateTime(data.syncedAt)})` : " (nenhum ainda)"}.
        </p>
      )}
      {sync?.status === "off" && <p className="text-theme-xs text-gray-500">Gestão Financeira não conectada (Configurações → Integrações).{data.syncedAt && ` Cópia de ${formatDateTime(data.syncedAt)}.`}</p>}
      {sync?.status === "offline" && (
        <p className="rounded-lg bg-gray-100 px-3 py-2 text-theme-xs text-gray-600 dark:bg-white/5 dark:text-gray-400">
          A Gestão Financeira não respondeu. {data.syncedAt ? `Mostrando a cópia de ${formatDateTime(data.syncedAt)}.` : "Ainda não há cópia."}
        </p>
      )}
      {data.cards.length === 0 ? (
        <p className="text-theme-sm text-gray-400">Nenhum lançamento na Gestão Financeira pelos cartões deste cliente.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-theme-xs" data-client-finance-totals>
            <Stat label="Receitas" value={t.incomeCents} sub={`recebido ${formatCents(t.incomePaidCents)}`} tone="good" />
            <Stat label="Despesas" value={t.expenseCents} sub={`pago ${formatCents(t.expensePaidCents)}`} tone="bad" />
            <Stat label="Resultado" value={t.resultCents} sub={t.margin == null ? "" : `margem ${(t.margin * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} tone={t.resultCents >= 0 ? "good" : "bad"} />
            <Stat label="A receber" value={t.receivableCents} sub={t.overdueReceivableCents ? `atrasado ${formatCents(t.overdueReceivableCents)}` : "nada atrasado"} tone={t.overdueReceivableCents ? "bad" : undefined} />
          </div>

          {data.receivables.length > 0 && (
            <div>
              <p className="mb-1 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">A receber</p>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                {data.receivables.map((e) => {
                  const due = e.dueDate ?? e.competenceDate;
                  return (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-theme-sm" data-client-receivable>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-gray-800 dark:text-white/90" title={e.description}>
                          {e.description}
                        </span>
                        <span className={cn("block text-theme-xs", due < today ? "font-medium text-error-600" : "text-gray-500")}>
                          {due < today ? `atrasado desde ${day(due)}` : `vence ${day(due)}`}
                          {/* O cartão só quando a descrição não é o próprio título dele. */}
                          {e.cardTitle !== e.description && <span className="font-normal text-gray-500"> · cartão {e.cardTitle}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold text-success-600">{formatCents(e.amountCents)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div>
            <p className="mb-1 text-theme-xs font-semibold uppercase tracking-wide text-gray-400">Por cartão</p>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.cards.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpenCard(c.pipelineId, c.id)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-theme-sm font-medium text-brand-600" title={c.title}>
                        {c.title}
                      </span>
                      <span className="block truncate text-theme-xs text-gray-500">
                        {c.pipelineName} · receitas {formatCents(c.incomeCents)} · despesas {formatCents(c.expenseCents)}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-theme-sm font-semibold", c.resultCents >= 0 ? "text-success-600" : "text-error-600")}>{formatCents(c.resultCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
      <div className="text-gray-500">{label}</div>
      <div className={cn("text-theme-sm font-semibold", tone === "good" ? "text-success-600" : tone === "bad" ? "text-error-600" : "text-gray-800 dark:text-white/90")}>{formatCents(value)}</div>
      <div className="text-gray-400">{sub}</div>
    </div>
  );
}
