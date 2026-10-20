// Relatórios → Financeiro (spec 13, Fase 3): receitas e despesas lançadas
// pelos cartões na Gestão Financeira — resultado e margem por cartão, cliente
// e funil, mês a mês, por categoria, e os ganhos com receita ainda por lançar.
// Lê tudo da Gestão Financeira ao abrir (e no "Atualizar"); sem ela, usa a
// última cópia guardada no CRM.
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { TaButton, TaInput, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import { FINANCE_BASIS_LABEL, type FinanceBasis, type FinanceReport, type FinanceTotals } from "../../db/finance";
import type { Pipeline } from "../../db/pipelines";
import type { Team } from "../../db/users";
import { PIPELINE_TYPE_LABEL, PIPELINE_TYPE_ORDER } from "../../lib/cardTypes";
import { formatCents, formatDateTime } from "../../lib/format";
import { formatPeriod, monthLabel, PERIOD_LABEL, presetPeriod, type Period, type PeriodPreset } from "../../lib/period";
import { downloadWorkbook } from "../../lib/xlsxExport";
import { syncAllFinance, type FinanceSyncResult } from "../../lib/finance/sync";
import { errorText } from "../../lib/errors";
import { useSession } from "../session";
import { BarChart, DataTable, ReportCard } from "./charts";

export type ReportKind = "comercial" | "financeiro";

export function ReportSwitch({ value, onChange }: { value: ReportKind; onChange: (v: ReportKind) => void }) {
  return (
    <div className="mr-auto flex items-center gap-3 self-center">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Relatórios</h2>
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-white/5" role="tablist">
        {(
          [
            ["comercial", "Comercial"],
            ["financeiro", "Financeiro"],
          ] as [ReportKind, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={value === id}
            data-report-kind={id}
            onClick={() => onChange(id)}
            className={cn(
              "rounded-md px-3 py-1 text-theme-sm font-medium",
              value === id ? "bg-white text-brand-600 shadow-theme-xs dark:bg-gray-900" : "text-gray-600 dark:text-gray-400",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

const money = (cents: number) => formatCents(cents);
const reais = (cents: number) => cents / 100;
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const pct1 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);
const moneyAxis = (r: number) =>
  Math.abs(r) >= 1_000_000 ? `R$ ${(r / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : Math.abs(r) >= 1000 ? `R$ ${(r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${r.toLocaleString("pt-BR")}`;
const moneyTip = (r: number) => formatCents(Math.round(r * 100));
const STATUS_LABEL = { open: "Em aberto", won: "Ganho/concluído", lost: "Perdido/não concluído" } as const;

export function FinanceReports({ switcher }: { switcher: React.ReactNode }) {
  const { user, users } = useSession();
  const [preset, setPreset] = useState<PeriodPreset>("ano");
  const [period, setPeriod] = useState<Period>(() => presetPeriod("ano"));
  const [basis, setBasis] = useState<FinanceBasis>("competencia");
  const [pipelineId, setPipelineId] = useState("");
  const [cardStatus, setCardStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [sync, setSync] = useState<FinanceSyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncKey, setSyncKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void call("pipelines.list", {}).then(setPipelines);
    void call("teams.list").then((t) => setTeams(t.filter((x) => x.active)));
  }, []);

  const refresh = async () => {
    setSyncing(true);
    setSync(await syncAllFinance());
    setSyncing(false);
    setSyncKey((k) => k + 1);
  };
  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    void call("finance.report", {
      start: period.start,
      end: period.end,
      basis,
      pipelineId: pipelineId || null,
      cardStatus: (cardStatus || null) as "open" | "won" | "lost" | null,
      ownerId: owner.startsWith("u:") ? owner.slice(2) : null,
      teamId: owner.startsWith("t:") ? owner.slice(2) : null,
      today: new Date().toLocaleDateString("sv-SE"),
    })
      .then((r) => {
        setReport(r);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [period, basis, pipelineId, cardStatus, owner, syncKey, user.id]);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? null;
  const scopeLabel = useMemo(() => {
    const parts = [formatPeriod(period), `por ${FINANCE_BASIS_LABEL[basis].toLowerCase()}`, pipeline ? pipeline.name : "Todos os funis"];
    if (cardStatus) parts.push(STATUS_LABEL[cardStatus as keyof typeof STATUS_LABEL]);
    if (owner.startsWith("u:")) parts.push(users.find((u) => u.id === owner.slice(2))?.name ?? "");
    if (owner.startsWith("t:")) parts.push(`Equipe ${teams.find((t) => t.id === owner.slice(2))?.name ?? ""}`);
    return parts.filter(Boolean).join(" · ");
  }, [period, basis, pipeline, cardStatus, owner, users, teams]);

  const exportExcel = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const r = report;
      const t = r.totals;
      const totalsHeader = ["Receitas (R$)", "Despesas (R$)", "Resultado (R$)", "Margem (%)", "Recebido (R$)", "A receber (R$)"];
      const totalsRow = (x: FinanceTotals) => [reais(x.incomeCents), reais(x.expenseCents), reais(x.resultCents), pct1(x.margin), reais(x.incomePaidCents), reais(x.receivableCents)];
      await downloadWorkbook(`conectcrm-financeiro-${period.start}-a-${period.end}.xlsx`, [
        {
          name: "Resumo",
          rows: [
            ["Financeiro ConectCRM", scopeLabel],
            ["Dados da Gestão Financeira de", r.syncedAt ? formatDateTime(r.syncedAt) : "—"],
            [],
            ["Indicador", "Valor"],
            ["Receitas (R$)", reais(t.incomeCents)],
            ["Despesas (R$)", reais(t.expenseCents)],
            ["Resultado (R$)", reais(t.resultCents)],
            ["Margem (%)", pct1(t.margin)],
            ["Recebido (R$)", reais(t.incomePaidCents)],
            ["Pago (R$)", reais(t.expensePaidCents)],
            ["A receber (R$)", reais(t.receivableCents)],
            ["A receber atrasado (R$)", reais(t.overdueReceivableCents)],
            ["A pagar (R$)", reais(t.payableCents)],
            ["A pagar atrasado (R$)", reais(t.overduePayableCents)],
          ],
        },
        { name: "Por mês", rows: [["Mês", "Receitas (R$)", "Despesas (R$)", "Resultado (R$)"], ...r.months.map((m) => [monthLabel(m.month), reais(m.incomeCents), reais(m.expenseCents), reais(m.resultCents)])] },
        {
          name: "Por cartão",
          rows: [["Cartão", "Cliente", "Funil", "Situação", "Valor do cartão (R$)", ...totalsHeader], ...r.cards.map((c) => [c.title, c.client ?? "", c.pipelineName, STATUS_LABEL[c.status], reais(c.valueCents), ...totalsRow(c)])],
        },
        { name: "Por cliente", rows: [["Cliente", "Cartões", ...totalsHeader], ...r.clients.map((c) => [c.name, c.cards, ...totalsRow(c)])] },
        { name: "Por funil", rows: [["Funil", "Cartões", ...totalsHeader], ...r.pipelines.map((c) => [c.name, c.cards, ...totalsRow(c)])] },
        { name: "Por categoria", rows: [["Tipo", "Categoria", "Valor (R$)"], ...r.categories.map((c) => [c.type === "income" ? "Receita" : "Despesa", c.name, reais(c.amountCents)])] },
        {
          name: "Receita a lançar",
          rows: [["Cartão", "Cliente", "Ganho em", "Valor (R$)", "Lançado (R$)", "Falta lançar (R$)"], ...r.toBill.map((b) => [b.title, b.client ?? "", b.closedAt ? formatDateTime(b.closedAt).slice(0, 10) : "", reais(b.valueCents), reais(b.launchedCents), reais(b.missingCents)])],
        },
      ]);
    } finally {
      setExporting(false);
    }
  };

  const label = "flex flex-col text-theme-xs text-gray-500";
  return (
    <div data-finance-reports>
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
        {switcher}
        <label className={label}>
          Período
          <TaSelect
            className="mt-1 w-44"
            value={preset}
            onChange={(e) => {
              const p = e.target.value as PeriodPreset;
              setPreset(p);
              if (p !== "custom") setPeriod(presetPeriod(p));
            }}
          >
            {(Object.keys(PERIOD_LABEL) as PeriodPreset[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </TaSelect>
        </label>
        {preset === "custom" && (
          <>
            <label className={label}>
              De
              <TaInput className="mt-1 w-40" type="date" value={period.start} max={period.end} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, start: e.target.value }))} />
            </label>
            <label className={label}>
              Até
              <TaInput className="mt-1 w-40" type="date" value={period.end} min={period.start} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, end: e.target.value }))} />
            </label>
          </>
        )}
        <label className={label} title="Competência: data do serviço/venda. Vencimento: quando vence. Caixa: só o que já foi pago ou recebido, pela data do pagamento.">
          Base
          <TaSelect className="mt-1 w-48" value={basis} onChange={(e) => setBasis(e.target.value as FinanceBasis)} data-finance-basis>
            {(Object.keys(FINANCE_BASIS_LABEL) as FinanceBasis[]).map((b) => (
              <option key={b} value={b}>
                {FINANCE_BASIS_LABEL[b]}
              </option>
            ))}
          </TaSelect>
        </label>
        <label className={label}>
          Funil
          <TaSelect className="mt-1 w-52" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Todos os funis</option>
            {PIPELINE_TYPE_ORDER.filter((t) => pipelines.some((p) => p.type === t)).map((t) => (
              <optgroup key={t} label={PIPELINE_TYPE_LABEL[t]}>
                {pipelines
                  .filter((p) => p.type === t)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </TaSelect>
        </label>
        <label className={label}>
          Situação do cartão
          <TaSelect className="mt-1 w-44" value={cardStatus} onChange={(e) => setCardStatus(e.target.value)}>
            <option value="">Todas</option>
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </TaSelect>
        </label>
        {user.role !== "vendedor" && (
          <label className={label}>
            Responsável
            <TaSelect className="mt-1 w-44" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{user.role === "admin" ? "Todos" : "Minha equipe"}</option>
              {teams.length > 0 && (
                <optgroup label="Equipes">
                  {teams.map((t) => (
                    <option key={t.id} value={`t:${t.id}`}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Usuários">
                {users
                  .filter((u) => u.active)
                  .map((u) => (
                    <option key={u.id} value={`u:${u.id}`}>
                      {u.name}
                    </option>
                  ))}
              </optgroup>
            </TaSelect>
          </label>
        )}
        <TaButton disabled={syncing} startIcon={<RefreshCw size={15} className={cn(syncing && "animate-spin")} />} onClick={() => void refresh()}>
          Atualizar
        </TaButton>
        <TaButton disabled={!report || exporting} startIcon={<Download size={15} />} onClick={() => void exportExcel()}>
          {exporting ? "Exportando…" : "Exportar Excel"}
        </TaButton>
      </div>

      <SyncNotice sync={sync} syncing={syncing} report={report} />
      {error && <p className="mb-4 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      {!report ? (
        <p className="text-theme-sm text-gray-500">Carregando…</p>
      ) : (
        <div className="space-y-5">
          <p className="text-theme-xs text-gray-500">{scopeLabel}</p>
          <Tiles t={report.totals} />
          <div className="grid gap-5 xl:grid-cols-2">
            <MonthsCard r={report} />
            <ClientsCard r={report} />
          </div>
          <CardsCard r={report} />
          <div className="grid gap-5 xl:grid-cols-2">
            <PipelinesCard r={report} />
            <CategoriesCard r={report} />
          </div>
          <ToBillCard r={report} />
        </div>
      )}
    </div>
  );
}

function SyncNotice({ sync, syncing, report }: { sync: FinanceSyncResult | null; syncing: boolean; report: FinanceReport | null }) {
  const base = "mb-4 rounded-lg px-3 py-2 text-theme-sm";
  if (syncing && !report) return <p className={cn(base, "bg-gray-100 text-gray-600 dark:bg-white/5")}>Lendo os lançamentos da Gestão Financeira…</p>;
  const when = report?.syncedAt ? formatDateTime(report.syncedAt) : null;
  const demo = report?.env === "demo" && <span className="ml-1 font-medium">A Gestão Financeira está no Ambiente de Teste: estes valores não são os reais.</span>;
  if (sync?.status === "off")
    return (
      <p className={cn(base, "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-400")} data-finance-sync="off">
        Os valores vêm da extensão Gestão Financeira (receitas e despesas lançadas pelos cartões). Conecte em Configurações → Integrações → Gestão Financeira.
        {when && ` Mostrando a cópia de ${when}.`}
      </p>
    );
  if (sync?.status === "offline")
    return (
      <p className={cn(base, "bg-warning-50 text-warning-800")} data-finance-sync="offline">
        A Gestão Financeira não respondeu ({sync.message}). {when ? `Mostrando a cópia de ${when}.` : "Ainda não há cópia dos lançamentos."}
        {demo}
      </p>
    );
  return (
    <p className="mb-4 text-theme-xs text-gray-500" data-finance-sync="ok">
      Dados da Gestão Financeira {when ? `de ${when}` : ""}.{demo}
    </p>
  );
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-theme-xs font-medium text-gray-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", tone === "good" ? "text-success-600" : tone === "bad" ? "text-error-600" : "text-gray-800 dark:text-white/90")}>{value}</p>
      {detail && <p className="mt-0.5 text-theme-xs text-gray-500">{detail}</p>}
    </div>
  );
}

function Tiles({ t }: { t: FinanceTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6" data-finance-tiles>
      <Tile label="Receitas" value={money(t.incomeCents)} detail={`recebido ${money(t.incomePaidCents)}`} tone="good" />
      <Tile label="Despesas" value={money(t.expenseCents)} detail={`pago ${money(t.expensePaidCents)}`} tone="bad" />
      <Tile label="Resultado" value={money(t.resultCents)} detail={`margem ${pct(t.margin)}`} tone={t.resultCents >= 0 ? "good" : "bad"} />
      <Tile label="Realizado" value={money(t.incomePaidCents - t.expensePaidCents)} detail="recebido − pago" />
      <Tile label="A receber" value={money(t.receivableCents)} detail={`atrasado ${money(t.overdueReceivableCents)}`} />
      <Tile label="A pagar" value={money(t.payableCents)} detail={`atrasado ${money(t.overduePayableCents)}`} />
    </div>
  );
}

function MonthsCard({ r }: { r: FinanceReport }) {
  return (
    <ReportCard
      title="Receitas e despesas por mês"
      subtitle="Lançamentos dos cartões, pela base escolhida"
      empty={r.months.some((m) => m.incomeCents || m.expenseCents) ? null : "Nenhum lançamento no período."}
      chart={
        <BarChart
          label="Receitas e despesas por mês"
          labels={r.months.map((m) => monthLabel(m.month))}
          series={[
            { label: "Receitas", data: r.months.map((m) => reais(m.incomeCents)) },
            { label: "Despesas", data: r.months.map((m) => reais(m.expenseCents)) },
          ]}
          format={moneyAxis}
          tooltipFormat={moneyTip}
        />
      }
      table={<DataTable headers={["Mês", "Receitas", "Despesas", "Resultado"]} rows={r.months.map((m) => [monthLabel(m.month), money(m.incomeCents), money(m.expenseCents), money(m.resultCents)])} />}
    />
  );
}

function ClientsCard({ r }: { r: FinanceReport }) {
  const top = r.clients.slice(0, 10);
  return (
    <ReportCard
      title="Resultado por cliente"
      subtitle="Organização do cartão (sem ela, o contato principal)"
      empty={r.clients.length ? null : "Nenhum lançamento no período."}
      chart={
        <BarChart
          horizontal
          label="Resultado por cliente"
          labels={top.map((c) => c.name)}
          series={[
            { label: "Receitas", data: top.map((c) => reais(c.incomeCents)) },
            { label: "Despesas", data: top.map((c) => reais(c.expenseCents)) },
          ]}
          format={moneyAxis}
          tooltipFormat={moneyTip}
        />
      }
      table={
        <DataTable
          headers={["Cliente", "Cartões", "Receitas", "Despesas", "Resultado", "Margem", "A receber"]}
          rows={r.clients.map((c) => [c.name, c.cards, money(c.incomeCents), money(c.expenseCents), money(c.resultCents), pct(c.margin), money(c.receivableCents)])}
        />
      }
    />
  );
}

function CardsCard({ r }: { r: FinanceReport }) {
  return (
    <ReportCard
      title="Resultado por cartão"
      subtitle="Receitas − despesas de cada negócio/projeto, com o valor do cartão para comparar"
      empty={r.cards.length ? null : "Nenhum lançamento no período."}
      table={
        <div data-finance-cards>
          <DataTable
            headers={["Cartão", "Cliente", "Funil", "Situação", "Valor do cartão", "Receitas", "Despesas", "Resultado", "Margem", "A receber"]}
            align={["left", "left", "left", "left", "right", "right", "right", "right", "right", "right"]}
            rows={r.cards.map((c) => [
              c.title,
              c.client ?? "—",
              c.pipelineName,
              STATUS_LABEL[c.status],
              money(c.valueCents),
              money(c.incomeCents),
              money(c.expenseCents),
              <span key="r" className={c.resultCents >= 0 ? "text-success-600" : "text-error-600"}>
                {money(c.resultCents)}
              </span>,
              pct(c.margin),
              c.overdueReceivableCents ? (
                <span key="a" className="text-error-600" title={`${money(c.overdueReceivableCents)} atrasado`}>
                  {money(c.receivableCents)}
                </span>
              ) : (
                money(c.receivableCents)
              ),
            ])}
          />
        </div>
      }
    />
  );
}

function PipelinesCard({ r }: { r: FinanceReport }) {
  return (
    <ReportCard
      title="Resultado por funil"
      empty={r.pipelines.length ? null : "Nenhum lançamento no período."}
      table={
        <DataTable
          headers={["Funil", "Cartões", "Receitas", "Despesas", "Resultado", "Margem"]}
          rows={r.pipelines.map((p) => [p.name, p.cards, money(p.incomeCents), money(p.expenseCents), money(p.resultCents), pct(p.margin)])}
        />
      }
    />
  );
}

function CategoriesCard({ r }: { r: FinanceReport }) {
  return (
    <ReportCard
      title="Por categoria"
      subtitle="Categoria/subcategoria escolhida no lançamento"
      empty={r.categories.length ? null : "Nenhum lançamento no período."}
      table={<DataTable headers={["Tipo", "Categoria", "Valor"]} align={["left", "left", "right"]} rows={r.categories.map((c) => [c.type === "income" ? "Receita" : "Despesa", c.name, money(c.amountCents)])} />}
    />
  );
}

function ToBillCard({ r }: { r: FinanceReport }) {
  return (
    <ReportCard
      title="Ganhos com receita a lançar"
      subtitle="Cartões ganhos no período cujo valor ainda não foi todo lançado como receita na Gestão Financeira"
      empty={r.toBill.length ? null : "Todos os ganhos do período já têm a receita lançada."}
      table={
        <div data-finance-tobill>
          <DataTable
            headers={["Cartão", "Cliente", "Ganho em", "Valor", "Lançado", "Falta lançar"]}
            align={["left", "left", "left", "right", "right", "right"]}
            rows={r.toBill.map((b) => [b.title, b.client ?? "—", b.closedAt ? new Date(b.closedAt).toLocaleDateString("pt-BR") : "—", money(b.valueCents), money(b.launchedCents), money(b.missingCents)])}
          />
        </div>
      }
    />
  );
}
