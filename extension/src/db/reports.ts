// Relatórios (Fase 10): conversão do funil, previsão (valor × probabilidade),
// ganhos/perdidos por período, motivo, responsável e equipe, tempo por etapa,
// produtos vendidos e atividades por usuário. Respeitam a permissão do
// usuário (mesma regra do quadro e das tarefas).
import { OUTCOME_TEXT } from "../lib/cardTypes";
import { isOverdue } from "../lib/taskTiming";
import { activityScope } from "./activities";
import { cardScope } from "./deals";
import { many, type DatabaseSync, type SqlValue } from "./sql";
import type { PipelineType } from "./pipelines";
import type { Viewer } from "./users";

export interface ReportFilter {
  /** Início (inclusive) e fim (exclusive) do período, ISO. */
  from: string;
  to: string;
  /** Um funil específico; sem ele, todos os funis comerciais. */
  pipelineId?: string | null;
  /** Restringe a estes responsáveis (usuário ou membros de uma equipe). */
  ownerIds?: string[] | null;
  viewer?: Viewer | null;
}

export interface Summary {
  won: { count: number; valueCents: number };
  lost: { count: number; valueCents: number };
  /** Ganhos ÷ (ganhos + perdidos) no período; null sem fechamentos. */
  winRate: number | null;
  avgTicketCents: number | null;
  /** Dias médios da criação ao ganho. */
  avgCycleDays: number | null;
  created: number;
  open: { count: number; valueCents: number };
  /** Abertos: Σ valor × probabilidade da etapa. */
  weightedCents: number;
}

export interface FunnelStep {
  stageId: string;
  name: string;
  color: string | null;
  /** Cartões criados no período que chegaram a esta etapa (ou passaram dela). */
  reached: number;
  /** % do passo anterior; null no primeiro. */
  fromPrevious: number | null;
}

export interface ForecastRow {
  pipelineName: string;
  stageName: string;
  probability: number | null;
  count: number;
  valueCents: number;
  weightedCents: number;
}

export interface MonthRow {
  /** "AAAA-MM" (fuso local). */
  month: string;
  won: number;
  wonValueCents: number;
  lost: number;
  lostValueCents: number;
}

export interface ReasonRow {
  reason: string;
  count: number;
  valueCents: number;
}

export interface OwnerRow {
  id: string | null;
  name: string;
  won: number;
  wonValueCents: number;
  lost: number;
  winRate: number | null;
  open: number;
  openValueCents: number;
  weightedCents: number;
  activitiesDone: number;
}

export interface StageTimeRow {
  stageId: string;
  name: string;
  /** Passagens concluídas no período. */
  passages: number;
  avgDays: number | null;
  /** Abertos hoje nesta etapa e há quantos dias, em média. */
  openNow: number;
  openAvgDays: number | null;
}

export interface ProductRow {
  name: string;
  quantity: number;
  totalCents: number;
  deals: number;
}

export interface ActivityRow {
  id: string | null;
  name: string;
  total: number;
  done: number;
  pending: number;
  overdue: number;
}

export interface Report {
  /** Tipo dos funis no relatório (sem funil escolhido: todos os comerciais). Define os termos do desfecho. */
  pipelineType: PipelineType;
  summary: Summary;
  funnel: FunnelStep[] | null;
  forecast: ForecastRow[];
  months: MonthRow[];
  lossReasons: ReasonRow[];
  owners: OwnerRow[];
  teams: (Omit<OwnerRow, "id" | "activitiesDone"> & { id: string })[];
  stageTime: StageTimeRow[] | null;
  products: ProductRow[];
  activities: ActivityRow[];
}

const DAY = 86_400_000;

interface DealRow {
  id: string;
  pipeline_id: string;
  stage_id: string;
  owner_id: string | null;
  status: "open" | "won" | "lost";
  value_cents: number;
  created_at: string;
  closed_at: string | null;
  stage_entered_at: string;
  loss_reason: string | null;
  probability: number | null;
  stage_name: string;
  stage_position: number;
  pipeline_name: string;
}

/** Cartões no escopo do filtro (funil, responsáveis e permissão). */
function scopedDeals(db: DatabaseSync, f: ReportFilter): DealRow[] {
  const where: string[] = ["d.deleted_at IS NULL", "p.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (f.pipelineId) {
    where.push("d.pipeline_id = ?");
    params.push(f.pipelineId);
  } else where.push("p.type = 'comercial' AND p.archived_at IS NULL");
  if (f.ownerIds?.length) {
    where.push(`d.owner_id IN (${f.ownerIds.map(() => "?").join(", ")})`);
    params.push(...f.ownerIds);
  }
  const scope = cardScope(db, f.viewer);
  return many<DealRow>(
    db,
    `SELECT d.id, d.pipeline_id, d.stage_id, d.owner_id, d.status, d.value_cents, d.created_at, d.closed_at, d.stage_entered_at,
            lr.name AS loss_reason, s.probability, s.name AS stage_name, s.position AS stage_position, p.name AS pipeline_name
     FROM deal d
     JOIN pipeline p ON p.id = d.pipeline_id
     JOIN stage s ON s.id = d.stage_id
     LEFT JOIN loss_reason lr ON lr.id = d.loss_reason_id
     WHERE ${where.join(" AND ")}${scope.sql}`,
    ...params,
    ...scope.params,
  );
}

const inPeriod = (iso: string | null, f: ReportFilter) => !!iso && iso >= f.from && iso < f.to;
const rate = (won: number, lost: number) => (won + lost ? won / (won + lost) : null);
const weighted = (d: DealRow) => Math.round((d.value_cents * (d.probability ?? 0)) / 100);

function localMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Todos os meses do período, mesmo sem fechamentos (eixo contínuo). */
function monthsBetween(f: ReportFilter): string[] {
  const out: string[] = [];
  const start = new Date(f.from);
  const end = new Date(new Date(f.to).getTime() - 1);
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end && out.length < 60; d.setMonth(d.getMonth() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function summarize(deals: DealRow[], f: ReportFilter): Summary {
  const won = deals.filter((d) => d.status === "won" && inPeriod(d.closed_at, f));
  const lost = deals.filter((d) => d.status === "lost" && inPeriod(d.closed_at, f));
  const open = deals.filter((d) => d.status === "open");
  const sum = (l: DealRow[]) => l.reduce((a, d) => a + d.value_cents, 0);
  const cycle = won.map((d) => (new Date(d.closed_at!).getTime() - new Date(d.created_at).getTime()) / DAY);
  return {
    won: { count: won.length, valueCents: sum(won) },
    lost: { count: lost.length, valueCents: sum(lost) },
    winRate: rate(won.length, lost.length),
    avgTicketCents: won.length ? Math.round(sum(won) / won.length) : null,
    avgCycleDays: cycle.length ? cycle.reduce((a, b) => a + b, 0) / cycle.length : null,
    created: deals.filter((d) => inPeriod(d.created_at, f)).length,
    open: { count: open.length, valueCents: sum(open) },
    weightedCents: open.reduce((a, d) => a + weighted(d), 0),
  };
}

/** Conversão: cada cartão criado no período conta em todas as etapas até a mais avançada que alcançou. */
function funnel(db: DatabaseSync, deals: DealRow[], f: ReportFilter, type: PipelineType): FunnelStep[] | null {
  if (!f.pipelineId) return null;
  const stages = many<{ id: string; name: string; color: string | null; position: number }>(
    db,
    "SELECT id, name, color, position FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position",
    f.pipelineId,
  );
  const created = deals.filter((d) => inPeriod(d.created_at, f));
  if (!created.length) return stages.map((s, i) => ({ stageId: s.id, name: s.name, color: s.color, reached: 0, fromPrevious: i ? null : null }));
  const ids = created.map((d) => d.id);
  const hist = many<{ deal_id: string; position: number }>(
    db,
    `SELECT h.deal_id, MAX(s.position) AS position FROM deal_stage_history h JOIN stage s ON s.id = h.stage_id
     WHERE h.deleted_at IS NULL AND h.deal_id IN (${ids.map(() => "?").join(", ")}) GROUP BY h.deal_id`,
    ...ids,
  );
  const maxPos = new Map(created.map((d) => [d.id, d.stage_position]));
  for (const h of hist) maxPos.set(h.deal_id, Math.max(maxPos.get(h.deal_id) ?? -Infinity, h.position));
  // Ganho (resolvido, concluído) conta como tendo passado por todas as etapas.
  const last = stages.at(-1)?.position ?? 0;
  for (const d of created) if (d.status === "won") maxPos.set(d.id, Math.max(maxPos.get(d.id)!, last));
  const steps: FunnelStep[] = [];
  for (const s of stages) {
    const reached = [...maxPos.values()].filter((p) => p >= s.position).length;
    const prev = steps.at(-1);
    steps.push({ stageId: s.id, name: s.name, color: s.color, reached, fromPrevious: prev ? (prev.reached ? reached / prev.reached : null) : null });
  }
  const won = created.filter((d) => d.status === "won").length;
  const prev = steps.at(-1);
  steps.push({ stageId: "won", name: OUTCOME_TEXT[type].won, color: null, reached: won, fromPrevious: prev?.reached ? won / prev.reached : null });
  return steps;
}

function forecast(deals: DealRow[]): ForecastRow[] {
  const map = new Map<string, ForecastRow & { pos: number }>();
  for (const d of deals.filter((x) => x.status === "open")) {
    const r = map.get(d.stage_id) ?? {
      pipelineName: d.pipeline_name,
      stageName: d.stage_name,
      probability: d.probability,
      count: 0,
      valueCents: 0,
      weightedCents: 0,
      pos: d.stage_position,
    };
    r.count++;
    r.valueCents += d.value_cents;
    r.weightedCents += weighted(d);
    map.set(d.stage_id, r);
  }
  return [...map.values()]
    .sort((a, b) => a.pipelineName.localeCompare(b.pipelineName) || a.pos - b.pos)
    .map(({ pos: _pos, ...r }) => r);
}

function byMonth(deals: DealRow[], f: ReportFilter): MonthRow[] {
  const rows = new Map(monthsBetween(f).map((m) => [m, { month: m, won: 0, wonValueCents: 0, lost: 0, lostValueCents: 0 }]));
  for (const d of deals) {
    if (d.status === "open" || !inPeriod(d.closed_at, f)) continue;
    const r = rows.get(localMonth(d.closed_at!));
    if (!r) continue;
    if (d.status === "won") {
      r.won++;
      r.wonValueCents += d.value_cents;
    } else {
      r.lost++;
      r.lostValueCents += d.value_cents;
    }
  }
  return [...rows.values()];
}

function lossReasons(deals: DealRow[], f: ReportFilter): ReasonRow[] {
  const map = new Map<string, ReasonRow>();
  for (const d of deals) {
    if (d.status !== "lost" || !inPeriod(d.closed_at, f)) continue;
    const key = d.loss_reason ?? "Sem motivo informado";
    const r = map.get(key) ?? { reason: key, count: 0, valueCents: 0 };
    r.count++;
    r.valueCents += d.value_cents;
    map.set(key, r);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.valueCents - a.valueCents);
}

function ownerStats(deals: DealRow[], f: ReportFilter) {
  const map = new Map<string | null, Omit<OwnerRow, "id" | "name" | "activitiesDone" | "winRate">>();
  for (const d of deals) {
    const r = map.get(d.owner_id) ?? { won: 0, wonValueCents: 0, lost: 0, open: 0, openValueCents: 0, weightedCents: 0 };
    if (d.status === "won" && inPeriod(d.closed_at, f)) {
      r.won++;
      r.wonValueCents += d.value_cents;
    } else if (d.status === "lost" && inPeriod(d.closed_at, f)) r.lost++;
    else if (d.status === "open") {
      r.open++;
      r.openValueCents += d.value_cents;
      r.weightedCents += weighted(d);
    }
    map.set(d.owner_id, r);
  }
  return map;
}

function stageTime(db: DatabaseSync, deals: DealRow[], f: ReportFilter, now: Date): StageTimeRow[] | null {
  if (!f.pipelineId) return null;
  const stages = many<{ id: string; name: string }>(db, "SELECT id, name FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position", f.pipelineId);
  const ids = deals.map((d) => d.id);
  const hist = ids.length
    ? many<{ stage_id: string; entered_at: string; left_at: string }>(
        db,
        // Cartão fechado: a passagem pela última etapa termina no fechamento.
        `SELECT * FROM (
           SELECT h.stage_id, h.entered_at, COALESCE(h.left_at, CASE WHEN d.status <> 'open' THEN d.closed_at END) AS left_at
           FROM deal_stage_history h JOIN deal d ON d.id = h.deal_id
           WHERE h.deleted_at IS NULL AND h.deal_id IN (${ids.map(() => "?").join(", ")})
         ) WHERE left_at IS NOT NULL AND left_at >= ? AND left_at < ?`,
        ...ids,
        f.from,
        f.to,
      )
    : [];
  const avg = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  return stages.map((s) => {
    const passages = hist.filter((h) => h.stage_id === s.id).map((h) => Math.max(0, new Date(h.left_at).getTime() - new Date(h.entered_at).getTime()) / DAY);
    const open = deals.filter((d) => d.status === "open" && d.stage_id === s.id).map((d) => (now.getTime() - new Date(d.stage_entered_at).getTime()) / DAY);
    return { stageId: s.id, name: s.name, passages: passages.length, avgDays: avg(passages), openNow: open.length, openAvgDays: avg(open) };
  });
}

function products(db: DatabaseSync, deals: DealRow[], f: ReportFilter): ProductRow[] {
  const won = deals.filter((d) => d.status === "won" && inPeriod(d.closed_at, f)).map((d) => d.id);
  if (!won.length) return [];
  const rows = many<{ name: string; quantity: number; total: number; deals: number }>(
    db,
    `SELECT COALESCE(pr.name, i.description) AS name, SUM(i.quantity) AS quantity, SUM(i.total_cents) AS total, COUNT(DISTINCT i.deal_id) AS deals
     FROM deal_item i LEFT JOIN product pr ON pr.id = i.product_id
     WHERE i.deleted_at IS NULL AND i.deal_id IN (${won.map(() => "?").join(", ")})
     GROUP BY COALESCE(i.product_id, i.description)
     ORDER BY total DESC`,
    ...won,
  );
  return rows.map((r) => ({ name: r.name, quantity: r.quantity, totalCents: r.total, deals: r.deals }));
}

function activities(db: DatabaseSync, f: ReportFilter, now: Date): ActivityRow[] {
  const scope = activityScope(db, f.viewer);
  const params: SqlValue[] = [f.from, f.to];
  let owners = "";
  if (f.ownerIds?.length) {
    owners = ` AND a.owner_id IN (${f.ownerIds.map(() => "?").join(", ")})`;
    params.push(...f.ownerIds);
  }
  const rows = many<{ owner_id: string | null; done: number; due_at: string; end_at: string | null }>(
    db,
    `SELECT a.owner_id, a.done, a.due_at, a.end_at FROM activity a
     WHERE a.deleted_at IS NULL AND a.due_at >= ? AND a.due_at < ?${owners}${scope.sql ? ` AND ${scope.sql}` : ""}`,
    ...params,
    ...scope.params,
  );
  const map = new Map<string | null, Omit<ActivityRow, "id" | "name">>();
  for (const a of rows) {
    const r = map.get(a.owner_id) ?? { total: 0, done: 0, pending: 0, overdue: 0 };
    r.total++;
    if (a.done) r.done++;
    else {
      r.pending++;
      if (isOverdue(a, now)) r.overdue++;
    }
    map.set(a.owner_id, r);
  }
  return [...map.entries()].map(([id, r]) => ({ id, name: "", ...r }));
}

export function buildReport(db: DatabaseSync, f: ReportFilter, now = new Date()): Report {
  const deals = scopedDeals(db, f);
  const pipelineType = (f.pipelineId && many<{ type: PipelineType }>(db, "SELECT type FROM pipeline WHERE id = ?", f.pipelineId)[0]?.type) || "comercial";
  const users = new Map(many<{ id: string; name: string }>(db, "SELECT id, name FROM app_user").map((u) => [u.id, u.name]));
  const nameOf = (id: string | null) => (id ? (users.get(id) ?? "Usuário removido") : "Sem responsável");

  const acts = activities(db, f, now).map((a) => ({ ...a, name: nameOf(a.id) }));
  const doneBy = new Map(acts.map((a) => [a.id, a.done]));
  const stats = ownerStats(deals, f);
  const owners: OwnerRow[] = [...stats.entries()]
    .map(([id, r]) => ({ id, name: nameOf(id), ...r, winRate: rate(r.won, r.lost), activitiesDone: doneBy.get(id) ?? 0 }))
    .filter((r) => r.won || r.lost || r.open || r.activitiesDone)
    .sort((a, b) => b.wonValueCents - a.wonValueCents || b.won - a.won || a.name.localeCompare(b.name));

  // Equipes: soma dos membros (quem está em duas equipes conta nas duas).
  const members = many<{ team_id: string; team_name: string; user_id: string }>(
    db,
    `SELECT t.id AS team_id, t.name AS team_name, m.user_id FROM team t
     JOIN team_member m ON m.team_id = t.id AND m.deleted_at IS NULL
     WHERE t.deleted_at IS NULL AND t.active = 1`,
  );
  const teamMap = new Map<string, Report["teams"][number]>();
  for (const m of members) {
    const s = stats.get(m.user_id);
    const t = teamMap.get(m.team_id) ?? { id: m.team_id, name: m.team_name, won: 0, wonValueCents: 0, lost: 0, winRate: null, open: 0, openValueCents: 0, weightedCents: 0 };
    if (s) {
      t.won += s.won;
      t.wonValueCents += s.wonValueCents;
      t.lost += s.lost;
      t.open += s.open;
      t.openValueCents += s.openValueCents;
      t.weightedCents += s.weightedCents;
    }
    t.winRate = rate(t.won, t.lost);
    teamMap.set(m.team_id, t);
  }

  return {
    pipelineType,
    summary: summarize(deals, f),
    funnel: funnel(db, deals, f, pipelineType),
    forecast: forecast(deals),
    months: byMonth(deals, f),
    lossReasons: lossReasons(deals, f),
    owners,
    teams: [...teamMap.values()].sort((a, b) => b.wonValueCents - a.wonValueCents || a.name.localeCompare(b.name)),
    stageTime: stageTime(db, deals, f, now),
    products: products(db, deals, f),
    activities: acts.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}
