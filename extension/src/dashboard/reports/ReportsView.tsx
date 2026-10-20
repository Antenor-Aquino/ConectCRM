// Relatórios (Fase 10): uma linha de filtros (período, funil, responsável) que
// vale para todos os cartões; indicadores no topo; cada gráfico com a tabela
// equivalente; exportação de tudo para Excel (uma aba por relatório).
import { useGfActive } from "../useGfActive";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, XCircle } from "lucide-react";
import { TaButton, TaInput, TaSelect, cn } from "@tailadmin";
import { call } from "../../rpc/client";
import type { Report } from "../../db/reports";
import type { Pipeline } from "../../db/pipelines";
import type { Team } from "../../db/users";
import { OUTCOME_TEXT, PIPELINE_TYPE_LABEL, PIPELINE_TYPE_ORDER, type OutcomeText } from "../../lib/cardTypes";
import { formatCents } from "../../lib/format";
import { formatPeriod, monthLabel, PERIOD_LABEL, periodToIso, presetPeriod, type Period, type PeriodPreset } from "../../lib/period";
import { downloadWorkbook } from "../../lib/xlsxExport";
import { useSession } from "../session";
import { BarChart, DataTable, ReportCard } from "./charts";
import { errorText } from "../../lib/errors";
import { FinanceReports, ReportSwitch, type ReportKind } from "./FinanceReports";

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const days = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`);
const money = (cents: number) => formatCents(cents);
/** Eixo em R$ sem centavos ("R$ 12 mil"). */
const moneyAxis = (reais: number) =>
  reais >= 1_000_000 ? `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : reais >= 1000 ? `R$ ${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${reais.toLocaleString("pt-BR")}`;
const moneyTip = (reais: number) => formatCents(Math.round(reais * 100));
const int = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

const pct1 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);

/** Relatórios: Comercial (funis) e Financeiro (lançamentos da Gestão Financeira). */
export function ReportsView() {
  const [view, setView] = useState<ReportKind>("comercial");
  // Relatório Financeiro só com a integração com a Gestão Financeira ativada.
  const gfActive = !!useGfActive();
  const switcher = gfActive ? <ReportSwitch value={view} onChange={setView} /> : <h2 className="mr-auto self-center text-lg font-semibold text-gray-800 dark:text-white/90">Relatórios</h2>;
  return view === "comercial" || !gfActive ? <CommercialReports switcher={switcher} /> : <FinanceReports switcher={switcher} />;
}

function CommercialReports({ switcher }: { switcher: React.ReactNode }) {
  const { user, users } = useSession();
  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const [period, setPeriod] = useState<Period>(() => presetPeriod("mes"));
  const [pipelineId, setPipelineId] = useState("");
  const [owner, setOwner] = useState(""); // "", "u:<id>" ou "t:<id>"
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void call("pipelines.list", {}).then(setPipelines);
    void call("teams.list").then((t) => setTeams(t.filter((x) => x.active)));
  }, []);

  useEffect(() => {
    setLoading(true);
    void call("reports.get", {
      ...periodToIso(period),
      pipelineId: pipelineId || null,
      ownerId: owner.startsWith("u:") ? owner.slice(2) : null,
      teamId: owner.startsWith("t:") ? owner.slice(2) : null,
    })
      .then((r) => {
        setReport(r);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, [period, pipelineId, owner, user.id]);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? null;
  const needPipeline = "Escolha um funil no filtro acima para ver as etapas.";
  const scopeLabel = useMemo(() => {
    const parts = [formatPeriod(period), pipeline ? pipeline.name : "Todos os funis comerciais"];
    if (owner.startsWith("u:")) parts.push(users.find((u) => u.id === owner.slice(2))?.name ?? "");
    if (owner.startsWith("t:")) parts.push(`Equipe ${teams.find((t) => t.id === owner.slice(2))?.name ?? ""}`);
    return parts.filter(Boolean).join(" · ");
  }, [period, pipeline, owner, users, teams]);

  const exportExcel = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const r = report;
      const s = r.summary;
      const t = OUTCOME_TEXT[r.pipelineType];
      const sales = r.pipelineType === "comercial";
      await downloadWorkbook(`conectcrm-relatorios-${period.start}-a-${period.end}.xlsx`, [
        {
          name: "Resumo",
          rows: [
            ["Relatórios ConectCRM", scopeLabel],
            [],
            ["Indicador", "Valor"],
            [`${t.wonPlural} (qtd.)`, s.won.count],
            ...(sales ? [[`${t.wonPlural} (R$)`, s.won.valueCents / 100]] : []),
            [`${t.lostPlural} (qtd.)`, s.lost.count],
            ...(sales ? [[`${t.lostPlural} (R$)`, s.lost.valueCents / 100]] : []),
            [`${t.rate} (%)`, s.winRate == null ? null : Math.round(s.winRate * 1000) / 10],
            ...(sales ? [["Ticket médio (R$)", s.avgTicketCents == null ? null : s.avgTicketCents / 100]] : []),
            [`Ciclo médio ${t.cycle} (dias)`, s.avgCycleDays == null ? null : Math.round(s.avgCycleDays * 10) / 10],
            ["Criados no período", s.created],
            ["Em aberto (qtd.)", s.open.count],
            ...(sales
              ? [
                  ["Em aberto (R$)", s.open.valueCents / 100],
                  ["Previsão ponderada (R$)", s.weightedCents / 100],
                ]
              : []),
          ],
        },
        {
          name: `${t.wonPlural} e ${t.lostPlural.toLowerCase()} por mês`.slice(0, 31),
          rows: sales
            ? [["Mês", t.wonPlural, `${t.wonPlural} (R$)`, t.lostPlural, `${t.lostPlural} (R$)`], ...r.months.map((m) => [monthLabel(m.month), m.won, m.wonValueCents / 100, m.lost, m.lostValueCents / 100])]
            : [["Mês", t.wonPlural, t.lostPlural], ...r.months.map((m) => [monthLabel(m.month), m.won, m.lost])],
        },
        ...(sales
          ? [
              {
                name: "Previsão",
                rows: [["Funil", "Etapa", "Probabilidade (%)", "Cartões", "Valor (R$)", "Ponderado (R$)"], ...r.forecast.map((f) => [f.pipelineName, f.stageName, f.probability, f.count, f.valueCents / 100, f.weightedCents / 100])],
              },
            ]
          : []),
        ...(r.funnel
          ? [{ name: "Conversão do funil", rows: [["Etapa", "Chegaram", "% da etapa anterior"], ...r.funnel.map((f) => [f.name, f.reached, f.fromPrevious == null ? null : Math.round(f.fromPrevious * 1000) / 10])] }]
          : []),
        ...(r.stageTime
          ? [
              {
                name: "Tempo por etapa",
                rows: [
                  ["Etapa", "Passagens concluídas", "Média (dias)", "Abertos agora", "Média dos abertos (dias)"],
                  ...r.stageTime.map((t) => [t.name, t.passages, t.avgDays == null ? null : Math.round(t.avgDays * 10) / 10, t.openNow, t.openAvgDays == null ? null : Math.round(t.openAvgDays * 10) / 10]),
                ],
              },
            ]
          : []),
        {
          name: sales ? "Motivos de perda" : "Motivos",
          rows: sales
            ? [["Motivo", "Quantidade", "Valor (R$)"], ...r.lossReasons.map((l) => [l.reason, l.count, l.valueCents / 100])]
            : [["Motivo", "Quantidade"], ...r.lossReasons.map((l) => [l.reason, l.count])],
        },
        {
          name: "Responsáveis",
          rows: [
            sales
              ? ["Responsável", t.wonPlural, `${t.wonPlural} (R$)`, t.lostPlural, `${t.rate} (%)`, "Abertos", "Abertos (R$)", "Ponderado (R$)", "Atividades concluídas"]
              : ["Responsável", t.wonPlural, t.lostPlural, `${t.rate} (%)`, "Abertos", "Atividades concluídas"],
            ...r.owners.map((o) =>
              sales
                ? [o.name, o.won, o.wonValueCents / 100, o.lost, pct1(o.winRate), o.open, o.openValueCents / 100, o.weightedCents / 100, o.activitiesDone]
                : [o.name, o.won, o.lost, pct1(o.winRate), o.open, o.activitiesDone],
            ),
          ],
        },
        {
          name: "Equipes",
          rows: [
            sales
              ? ["Equipe", t.wonPlural, `${t.wonPlural} (R$)`, t.lostPlural, `${t.rate} (%)`, "Abertos", "Abertos (R$)", "Ponderado (R$)"]
              : ["Equipe", t.wonPlural, t.lostPlural, `${t.rate} (%)`, "Abertos"],
            ...r.teams.map((x) =>
              sales
                ? [x.name, x.won, x.wonValueCents / 100, x.lost, pct1(x.winRate), x.open, x.openValueCents / 100, x.weightedCents / 100]
                : [x.name, x.won, x.lost, pct1(x.winRate), x.open],
            ),
          ],
        },
        ...(sales
          ? [{ name: "Produtos vendidos", rows: [["Produto/serviço", "Quantidade", "Total (R$)", "Negócios"], ...r.products.map((p) => [p.name, p.quantity, p.totalCents / 100, p.deals])] }]
          : []),
        { name: "Atividades", rows: [["Responsável", "No período", "Concluídas", "Pendentes", "Atrasadas"], ...r.activities.map((a) => [a.name, a.total, a.done, a.pending, a.overdue])] },
      ]);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Filtros: uma linha só, valem para todos os relatórios. */}
      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
        {switcher}
        <label className="flex flex-col text-theme-xs text-gray-500">
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
            <label className="flex flex-col text-theme-xs text-gray-500">
              De
              <TaInput className="mt-1 w-40" type="date" value={period.start} max={period.end} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, start: e.target.value }))} />
            </label>
            <label className="flex flex-col text-theme-xs text-gray-500">
              Até
              <TaInput className="mt-1 w-40" type="date" value={period.end} min={period.start} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, end: e.target.value }))} />
            </label>
          </>
        )}
        <label className="flex flex-col text-theme-xs text-gray-500">
          Funil
          <TaSelect className="mt-1 w-56" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Todos os funis comerciais</option>
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
        {user.role !== "vendedor" && (
          <label className="flex flex-col text-theme-xs text-gray-500">
            Responsável
            <TaSelect className="mt-1 w-52" value={owner} onChange={(e) => setOwner(e.target.value)}>
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
        <TaButton disabled={!report || exporting} startIcon={<Download size={15} />} onClick={() => void exportExcel()}>
          {exporting ? "Exportando…" : "Exportar Excel"}
        </TaButton>
      </div>

      {error && <p className="mb-4 rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700">{error}</p>}
      {!report ? (
        <p className="text-theme-sm text-gray-500">Carregando…</p>
      ) : (
        // Recarga mantém o resultado anterior esmaecido (sem piscar).
        <div className={cn("space-y-5 transition-opacity", loading && "opacity-60")}>
          <p className="text-theme-xs text-gray-500">{scopeLabel}</p>
          <Tiles r={report} />
          <div className="grid gap-5 xl:grid-cols-2">
            <MonthsCard r={report} />
            {/* Previsão e produtos só fazem sentido em vendas (funis comerciais). */}
            {report.pipelineType === "comercial" && <ForecastCard r={report} />}
            <FunnelCard r={report} empty={report.funnel ? null : needPipeline} />
            <StageTimeCard r={report} empty={report.stageTime ? null : needPipeline} />
            <LossCard r={report} />
            {report.pipelineType === "comercial" && <ProductsCard r={report} />}
          </div>
          <OwnersCard r={report} />
          {report.teams.length > 0 && user.role !== "vendedor" && <TeamsCard r={report} />}
          <ActivitiesCard r={report} />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, detail, icon, tone }: { label: string; value: string; detail?: string; icon?: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="flex items-center gap-1.5 text-theme-xs font-medium text-gray-500">
        {icon && <span className={tone === "good" ? "text-success-600" : "text-error-600"}>{icon}</span>}
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-800 dark:text-white/90">{value}</p>
      {detail && <p className="mt-0.5 text-theme-xs text-gray-500">{detail}</p>}
    </div>
  );
}

/** Termos do desfecho e se o relatório é de vendas (valores em R$). */
const termsOf = (r: Report): { t: OutcomeText; sales: boolean } => ({ t: OUTCOME_TEXT[r.pipelineType], sales: r.pipelineType === "comercial" });

function Tiles({ r }: { r: Report }) {
  const s = r.summary;
  const { t, sales } = termsOf(r);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {sales ? (
        <>
          <Tile label={t.wonPlural} icon={<CheckCircle2 size={14} />} tone="good" value={money(s.won.valueCents)} detail={`${s.won.count} fechado(s) no período`} />
          <Tile label={t.lostPlural} icon={<XCircle size={14} />} tone="bad" value={money(s.lost.valueCents)} detail={`${s.lost.count} no período`} />
        </>
      ) : (
        <>
          <Tile label={t.wonPlural} icon={<CheckCircle2 size={14} />} tone="good" value={int(s.won.count)} detail="no período" />
          <Tile label={t.lostPlural} icon={<XCircle size={14} />} tone="bad" value={int(s.lost.count)} detail="no período" />
        </>
      )}
      <Tile label={t.rate} value={pct(s.winRate)} detail={t.rateDetail} />
      {sales ? (
        <Tile label="Ticket médio" value={s.avgTicketCents == null ? "—" : money(s.avgTicketCents)} detail={`ciclo médio ${days(s.avgCycleDays)}`} />
      ) : (
        <Tile label="Tempo médio" value={days(s.avgCycleDays)} detail={`da criação ${t.cycle}`} />
      )}
      <Tile label="Em aberto" value={sales ? money(s.open.valueCents) : int(s.open.count)} detail={sales ? `${s.open.count} cartão(ões) hoje` : "cartão(ões) hoje"} />
      {sales && <Tile label="Previsão ponderada" value={money(s.weightedCents)} detail="valor × probabilidade da etapa" />}
      <Tile label="Criados no período" value={int(s.created)} />
      <Tile label="Atividades concluídas" value={int(r.activities.reduce((a, x) => a + x.done, 0))} detail={`${int(r.activities.reduce((a, x) => a + x.overdue, 0))} atrasada(s)`} />
    </div>
  );
}

function MonthsCard({ r }: { r: Report }) {
  const { t, sales } = termsOf(r);
  const title = `${t.wonPlural} e ${t.lostPlural.toLowerCase()} por mês`;
  return (
    <ReportCard
      title={title}
      subtitle={sales ? "Valor dos cartões fechados em cada mês" : "Cartões fechados em cada mês"}
      chart={
        <BarChart
          label={title}
          labels={r.months.map((m) => monthLabel(m.month))}
          series={
            sales
              ? [
                  { label: t.wonPlural, data: r.months.map((m) => m.wonValueCents / 100) },
                  { label: t.lostPlural, data: r.months.map((m) => m.lostValueCents / 100) },
                ]
              : [
                  { label: t.wonPlural, data: r.months.map((m) => m.won) },
                  { label: t.lostPlural, data: r.months.map((m) => m.lost) },
                ]
          }
          format={sales ? moneyAxis : int}
          tooltipFormat={sales ? moneyTip : undefined}
        />
      }
      table={
        sales ? (
          <DataTable
            headers={["Mês", t.wonPlural, "Valor", t.lostPlural, "Valor"]}
            rows={r.months.map((m) => [monthLabel(m.month), m.won, money(m.wonValueCents), m.lost, money(m.lostValueCents)])}
          />
        ) : (
          <DataTable headers={["Mês", t.wonPlural, t.lostPlural]} rows={r.months.map((m) => [monthLabel(m.month), m.won, m.lost])} />
        )
      }
    />
  );
}

function ForecastCard({ r }: { r: Report }) {
  const multi = new Set(r.forecast.map((f) => f.pipelineName)).size > 1;
  const name = (f: Report["forecast"][number]) => (multi ? `${f.pipelineName} · ${f.stageName}` : f.stageName);
  return (
    <ReportCard
      title="Previsão por etapa"
      subtitle="Abertos hoje: valor total e ponderado pela probabilidade da etapa"
      empty={r.forecast.length ? null : "Nenhum cartão em aberto."}
      chart={
        <BarChart
          horizontal
          label="Previsão por etapa"
          labels={r.forecast.map(name)}
          series={[
            { label: "Em aberto", data: r.forecast.map((f) => f.valueCents / 100) },
            { label: "Ponderado", data: r.forecast.map((f) => f.weightedCents / 100) },
          ]}
          format={moneyAxis}
          tooltipFormat={moneyTip}
        />
      }
      table={
        <DataTable
          headers={["Etapa", "Prob.", "Cartões", "Em aberto", "Ponderado"]}
          rows={r.forecast.map((f) => [name(f), f.probability == null ? "—" : `${f.probability}%`, f.count, money(f.valueCents), money(f.weightedCents)])}
        />
      }
    />
  );
}

function FunnelCard({ r, empty }: { r: Report; empty: string | null }) {
  const steps = r.funnel ?? [];
  return (
    <ReportCard
      title="Conversão do funil"
      subtitle="Cartões criados no período que chegaram a cada etapa"
      empty={empty}
      chart={
        <BarChart
          horizontal
          label="Conversão do funil"
          labels={steps.map((s) => (s.fromPrevious == null ? s.name : `${s.name} · ${pct(s.fromPrevious)}`))}
          series={[{ label: "Chegaram", data: steps.map((s) => s.reached) }]}
          format={int}
        />
      }
      table={<DataTable headers={["Etapa", "Chegaram", "% da anterior"]} rows={steps.map((s) => [s.name, s.reached, pct(s.fromPrevious)])} />}
    />
  );
}

function StageTimeCard({ r, empty }: { r: Report; empty: string | null }) {
  const rows = r.stageTime ?? [];
  return (
    <ReportCard
      title="Tempo médio por etapa"
      subtitle="Dias até sair da etapa (passagens concluídas no período)"
      empty={empty}
      chart={<BarChart horizontal label="Tempo médio por etapa" labels={rows.map((t) => t.name)} series={[{ label: "Média (dias)", data: rows.map((t) => Math.round((t.avgDays ?? 0) * 10) / 10) }]} format={(v) => `${v.toLocaleString("pt-BR")} d`} />}
      table={
        <DataTable
          headers={["Etapa", "Passagens", "Média", "Abertos agora", "Parados há (média)"]}
          rows={rows.map((t) => [t.name, t.passages, days(t.avgDays), t.openNow, days(t.openAvgDays)])}
        />
      }
    />
  );
}

function LossCard({ r }: { r: Report }) {
  const { t, sales } = termsOf(r);
  const title = sales ? "Motivos de perda" : `Motivos (${t.lost.toLowerCase()})`;
  return (
    <ReportCard
      title={title}
      subtitle={`Cartões ${t.lostPlural.toLowerCase()} no período`}
      empty={r.lossReasons.length ? null : sales ? "Nenhuma perda no período." : `Nenhum cartão ${t.lost.toLowerCase()} no período.`}
      chart={<BarChart horizontal label={title} labels={r.lossReasons.map((l) => l.reason)} series={[{ label: t.lostPlural, data: r.lossReasons.map((l) => l.count) }]} format={int} />}
      table={
        sales ? (
          <DataTable headers={["Motivo", "Quantidade", "Valor"]} rows={r.lossReasons.map((l) => [l.reason, l.count, money(l.valueCents)])} />
        ) : (
          <DataTable headers={["Motivo", "Quantidade"]} rows={r.lossReasons.map((l) => [l.reason, l.count])} />
        )
      }
    />
  );
}

function ProductsCard({ r }: { r: Report }) {
  const top = r.products.slice(0, 10);
  return (
    <ReportCard
      title="Produtos e serviços vendidos"
      subtitle={r.products.length > 10 ? "Os 10 maiores no gráfico; todos na tabela" : "Itens dos negócios ganhos no período"}
      empty={r.products.length ? null : "Nenhum item vendido no período."}
      chart={<BarChart horizontal label="Produtos vendidos" labels={top.map((p) => p.name)} series={[{ label: "Total", data: top.map((p) => p.totalCents / 100) }]} format={moneyAxis}
          tooltipFormat={moneyTip} />}
      table={<DataTable headers={["Produto/serviço", "Quantidade", "Total", "Negócios"]} rows={r.products.map((p) => [p.name, p.quantity.toLocaleString("pt-BR"), money(p.totalCents), p.deals])} />}
    />
  );
}

function OwnersCard({ r }: { r: Report }) {
  const { t, sales } = termsOf(r);
  return (
    <ReportCard
      title="Desempenho por responsável"
      subtitle={sales ? "Ganhos e perdas no período; abertos e previsão de hoje" : `${t.wonPlural} e ${t.lostPlural.toLowerCase()} no período; abertos hoje`}
      table={
        sales ? (
          <DataTable
            headers={["Responsável", t.wonPlural, "Valor ganho", t.lostPlural, "Conversão", "Abertos", "Em aberto", "Ponderado", "Atividades feitas"]}
            rows={r.owners.map((o) => [o.name, o.won, money(o.wonValueCents), o.lost, pct(o.winRate), o.open, money(o.openValueCents), money(o.weightedCents), o.activitiesDone])}
          />
        ) : (
          <DataTable
            headers={["Responsável", t.wonPlural, t.lostPlural, t.rate, "Abertos", "Atividades feitas"]}
            rows={r.owners.map((o) => [o.name, o.won, o.lost, pct(o.winRate), o.open, o.activitiesDone])}
          />
        )
      }
    />
  );
}

function TeamsCard({ r }: { r: Report }) {
  return (
    <ReportCard
      title="Desempenho por equipe"
      subtitle="Soma dos membros (quem está em duas equipes conta nas duas)"
      table={
        termsOf(r).sales ? (
          <DataTable
            headers={["Equipe", "Ganhos", "Valor ganho", "Perdidos", "Conversão", "Abertos", "Em aberto", "Ponderado"]}
            rows={r.teams.map((t) => [t.name, t.won, money(t.wonValueCents), t.lost, pct(t.winRate), t.open, money(t.openValueCents), money(t.weightedCents)])}
          />
        ) : (
          <DataTable
            headers={["Equipe", termsOf(r).t.wonPlural, termsOf(r).t.lostPlural, termsOf(r).t.rate, "Abertos"]}
            rows={r.teams.map((x) => [x.name, x.won, x.lost, pct(x.winRate), x.open])}
          />
        )
      }
    />
  );
}

function ActivitiesCard({ r }: { r: Report }) {
  return (
    <ReportCard
      title="Atividades por usuário"
      subtitle="Atividades com data no período"
      empty={r.activities.length ? null : "Nenhuma atividade no período."}
      chart={
        <BarChart
          label="Atividades por usuário"
          labels={r.activities.map((a) => a.name)}
          series={[
            { label: "Concluídas", data: r.activities.map((a) => a.done) },
            { label: "Pendentes", data: r.activities.map((a) => a.pending) },
          ]}
          format={int}
          height={240}
        />
      }
      table={
        <DataTable
          headers={["Responsável", "No período", "Concluídas", "Pendentes", "Atrasadas"]}
          rows={r.activities.map((a) => [a.name, a.total, a.done, a.pending, a.overdue])}
        />
      }
    />
  );
}
