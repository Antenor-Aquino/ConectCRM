// Atividades recorrentes (spec 02, Atividades recorrentes). A série guarda a
// regra (lib/recurrence.ts) e o modelo da atividade; as ocorrências são
// atividades normais (concluir, adiar, notas, lembretes, documentos), criadas
// para os próximos SERIES_HORIZON_DAYS dias — ou uma por vez em "repetir só
// depois de concluir". Sem data final, a série segue indefinidamente até ser
// encerrada ou excluída; a janela de dias à frente evita encher o banco.
import { nextAfterDone, occurrences, validateRule, type RecurrenceRule } from "../lib/recurrence";
import { ValidationError } from "../lib/validate";
import { createActivity, deleteActivity, getActivity, updateActivity, type ActivityInput } from "./activities";
import { insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { moveToTrash, type TrashNotice } from "./trash";
import { many, one, withTransaction, type DatabaseSync } from "./sql";

export const SERIES_HORIZON_DAYS = 60;

/** O que se repete em toda ocorrência (datas vêm da regra). */
export type SeriesTemplate = Omit<ActivityInput, "dueAt" | "endAt" | "done" | "reminderMin"> & {
  /** Finalização = início + estes minutos (null = sem finalização). */
  endOffsetMin?: number | null;
};

interface SeriesRow {
  id: string;
  rule: string;
  start_at: string;
  from_at: string;
  template: string;
  skipped: string;
  stop_index: number | null;
}

export interface Series {
  id: string;
  rule: RecurrenceRule;
  startAt: string;
  fromAt: string;
  template: SeriesTemplate;
  skipped: number[];
  stopIndex: number | null;
}

export type SeriesScope = "this" | "following" | "all";

function parse(r: SeriesRow): Series {
  return {
    id: r.id,
    rule: JSON.parse(r.rule) as RecurrenceRule,
    startAt: r.start_at,
    fromAt: r.from_at,
    template: JSON.parse(r.template) as SeriesTemplate,
    skipped: JSON.parse(r.skipped) as number[],
    stopIndex: r.stop_index,
  };
}

export function getSeries(db: DatabaseSync, id: string): Series | undefined {
  const r = one<SeriesRow>(db, "SELECT id, rule, start_at, from_at, template, skipped, stop_index FROM activity_series WHERE id = ? AND deleted_at IS NULL", id);
  return r ? parse(r) : undefined;
}

function checkRule(rule: RecurrenceRule): RecurrenceRule {
  const err = validateRule(rule);
  if (err) throw new ValidationError(err);
  return {
    freq: rule.freq,
    interval: rule.interval,
    ...(rule.workdaysOnly ? { workdaysOnly: true } : {}),
    ...(rule.weekdays?.length ? { weekdays: [...new Set(rule.weekdays)].sort() } : {}),
    ...(rule.monthly ? { monthly: rule.monthly } : {}),
    end: rule.end,
    ...(rule.afterDone ? { afterDone: true } : {}),
  };
}

/** Modelo a partir do que veio do formulário. */
function templateOf(input: ActivityInput): SeriesTemplate {
  const { dueAt, endAt, done: _d, reminderMin: _r, ...rest } = input;
  const start = dueAt ? new Date(dueAt).getTime() : Date.now();
  return { ...rest, endOffsetMin: endAt ? Math.max(0, Math.round((new Date(endAt).getTime() - start) / 60_000)) : null };
}

function startOfToday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Cria a série e as primeiras ocorrências; devolve a 1ª ocorrência criada (ou null). */
export function createSeries(db: DatabaseSync, ctx: DbContext, input: ActivityInput & { recurrence: RecurrenceRule }, now = new Date()): { seriesId: string; firstId: string | null } {
  return withTransaction(db, () => {
    const rule = checkRule(input.recurrence);
    const { recurrence: _r, ...activity } = input;
    const start = activity.dueAt ? new Date(activity.dueAt) : now;
    if (Number.isNaN(start.getTime())) throw new ValidationError("Início: data inválida.");
    if (rule.end.type === "until" && rule.end.date < localDate(start)) throw new ValidationError("A data final da recorrência é antes do início.");
    // Validação do modelo: cria-se a 1ª ocorrência pelo caminho normal (mesmas regras).
    const template = templateOf(activity);
    // Início no passado: as ocorrências começam hoje (não cria um monte de atrasadas).
    const from = start < startOfToday(now) ? startOfToday(now) : start;
    const seriesId = insertRow(db, ctx, "activity_series", {
      rule: JSON.stringify(rule),
      start_at: start.toISOString(),
      from_at: from.toISOString(),
      template: JSON.stringify(template),
      skipped: "[]",
      stop_index: null,
    });
    const created = topUpSeries(db, ctx, seriesId, now);
    if (!created.length && !rule.afterDone) throw new ValidationError("Essa recorrência não tem nenhuma ocorrência a partir de hoje. Confira o início e a data final.");
    return { seriesId, firstId: created[0] ?? null };
  });
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function createOccurrence(db: DatabaseSync, ctx: DbContext, s: Series, index: number, at: Date): string {
  const { endOffsetMin, ...t } = s.template;
  const id = createActivity(db, ctx, {
    ...t,
    dueAt: at.toISOString(),
    endAt: endOffsetMin != null ? new Date(at.getTime() + endOffsetMin * 60_000).toISOString() : null,
  });
  updateRow(db, ctx, "activity", id, { series_id: s.id, series_index: index });
  return id;
}

interface OccRow {
  id: string;
  series_index: number;
  done: number;
  done_at: string | null;
  due_at: string;
}

const activeOccurrences = (db: DatabaseSync, seriesId: string) =>
  many<OccRow>(db, "SELECT id, series_index, done, done_at, due_at FROM activity WHERE series_id = ? AND deleted_at IS NULL ORDER BY series_index", seriesId);

/** Cria as ocorrências que faltam até o horizonte; devolve os ids criados. */
export function topUpSeries(db: DatabaseSync, ctx: DbContext, seriesId: string, now = new Date()): string[] {
  const s = getSeries(db, seriesId);
  if (!s) return [];
  const start = new Date(s.startAt);
  const occs = activeOccurrences(db, s.id);
  const skipped = new Set(s.skipped);
  const allowed = (index: number, at: Date) =>
    !skipped.has(index) &&
    (s.stopIndex == null || index <= s.stopIndex) &&
    (s.rule.end.type !== "count" || index <= s.rule.end.count) &&
    (s.rule.end.type !== "until" || localDate(at) <= s.rule.end.date);
  const created: string[] = [];
  if (s.rule.afterDone) {
    if (occs.some((o) => !o.done)) return [];
    const last = occs.at(-1);
    const maxIndex = Math.max(0, ...occs.map((o) => o.series_index), ...s.skipped);
    const at = !last ? new Date(Math.max(start.getTime(), new Date(s.fromAt).getTime())) : nextAfterDone(s.rule, start, new Date(last.done_at ?? last.due_at));
    const index = maxIndex + 1;
    if (allowed(index, at)) created.push(createOccurrence(db, ctx, s, index, at));
    return created;
  }
  const present = new Set(occs.map((o) => o.series_index));
  const horizon = new Date(now.getTime() + SERIES_HORIZON_DAYS * 86400_000);
  const from = new Date(s.fromAt);
  for (const o of occurrences(s.rule, start, horizon)) {
    if (o.at < from || present.has(o.index) || !allowed(o.index, o.at)) continue;
    created.push(createOccurrence(db, ctx, s, o.index, o.at));
  }
  return created;
}

/** Rotina (no máximo a cada poucas horas): completa todas as séries ativas. */
export function topUpAllSeries(db: DatabaseSync, ctx: DbContext, now = new Date()): number {
  let n = 0;
  for (const { id } of many<{ id: string }>(db, "SELECT id FROM activity_series WHERE deleted_at IS NULL")) {
    n += withTransaction(db, () => topUpSeries(db, ctx, id, now).length);
  }
  return n;
}

/** Atividade comum que passou a repetir: vira a 1ª ocorrência da série (ou fica fora da regra, índice 0). */
export function makeRecurring(db: DatabaseSync, ctx: DbContext, activityId: string, recurrence: RecurrenceRule, now = new Date()): string {
  return withTransaction(db, () => {
    const a = getActivity(db, activityId);
    if (!a) throw new ValidationError("Atividade não encontrada.");
    const rule = checkRule(recurrence);
    const start = new Date(a.due_at);
    const template: SeriesTemplate = {
      typeId: a.type_id,
      title: a.title,
      description: a.description,
      durationMin: a.duration_min,
      reminders: a.reminders,
      ownerId: a.owner_id,
      dealId: a.deal_id,
      personId: a.person_id,
      organizationId: a.organization_id,
      customValues: a.customValues,
      tagIds: a.tagIds,
      endOffsetMin: a.end_at ? Math.max(0, Math.round((new Date(a.end_at).getTime() - start.getTime()) / 60_000)) : null,
    };
    const from = start < startOfToday(now) ? startOfToday(now) : start;
    const seriesId = insertRow(db, ctx, "activity_series", {
      rule: JSON.stringify(rule),
      start_at: start.toISOString(),
      from_at: from.toISOString(),
      template: JSON.stringify(template),
      skipped: "[]",
      stop_index: null,
    });
    const first = rule.afterDone ? null : occurrences(rule, start, start)[0];
    updateRow(db, ctx, "activity", activityId, { series_id: seriesId, series_index: rule.afterDone || (first && Math.abs(first.at.getTime() - start.getTime()) < 60_000) ? 1 : 0 });
    topUpSeries(db, ctx, seriesId, now);
    return seriesId;
  });
}

/** Concluiu uma ocorrência de "repetir só depois de concluir": cria a próxima. */
export function afterOccurrenceDone(db: DatabaseSync, ctx: DbContext, activityId: string, now = new Date()): string | null {
  const a = one<{ series_id: string | null }>(db, "SELECT series_id FROM activity WHERE id = ?", activityId);
  if (!a?.series_id) return null;
  const s = getSeries(db, a.series_id);
  if (!s?.rule.afterDone) return null;
  return withTransaction(db, () => topUpSeries(db, ctx, s.id, now)[0] ?? null);
}

function occurrenceOf(db: DatabaseSync, activityId: string): { occ: OccRow & { series_id: string }; series: Series } {
  const occ = one<OccRow & { series_id: string | null }>(db, "SELECT id, series_id, series_index, done, done_at, due_at FROM activity WHERE id = ? AND deleted_at IS NULL", activityId);
  if (!occ?.series_id) throw new ValidationError("Esta atividade não faz parte de uma recorrência.");
  const series = getSeries(db, occ.series_id);
  if (!series) throw new ValidationError("Recorrência não encontrada.");
  return { occ: occ as OccRow & { series_id: string }, series };
}

/** Pendentes da série a partir de uma ocorrência (as concluídas ficam como histórico). */
const pendingFrom = (db: DatabaseSync, seriesId: string, fromIndex: number) =>
  many<{ id: string }>(db, "SELECT id FROM activity WHERE series_id = ? AND deleted_at IS NULL AND done = 0 AND series_index >= ?", seriesId, fromIndex);

function softDeleteWithNotes(db: DatabaseSync, ctx: DbContext, id: string): void {
  for (const n of many<{ id: string }>(db, "SELECT id FROM note WHERE entity_type = 'activity' AND entity_id = ? AND deleted_at IS NULL", id)) softDelete(db, ctx, "note", n.id);
  softDelete(db, ctx, "activity", id);
}

/**
 * Alterar "esta e as próximas" ou "todas". Sem mudar data/hora nem a regra,
 * as pendentes são alteradas no lugar (notas e documentos ficam); mudando,
 * as pendentes são refeitas pela nova regra. "Esta e as próximas" no meio da
 * série divide em duas: a antiga acaba antes desta.
 */
export function updateSeries(
  db: DatabaseSync,
  ctx: DbContext,
  activityId: string,
  scope: Exclude<SeriesScope, "this">,
  patch: Partial<ActivityInput>,
  newRule?: RecurrenceRule,
  now = new Date(),
): void {
  withTransaction(db, () => {
    const { occ, series } = occurrenceOf(db, activityId);
    const rule = newRule ? checkRule(newRule) : series.rule;
    const ruleChanged = JSON.stringify(rule) !== JSON.stringify(series.rule);
    const oldDue = new Date(occ.due_at);
    const newDue = patch.dueAt ? new Date(patch.dueAt) : oldDue;
    const shift = newDue.getTime() - oldDue.getTime();
    const { dueAt: _d, endAt: _e, done: _dn, reminderMin: _r, ...fields } = patch;
    const endOffsetMin =
      patch.endAt !== undefined ? (patch.endAt ? Math.max(0, Math.round((new Date(patch.endAt).getTime() - newDue.getTime()) / 60_000)) : null) : series.template.endOffsetMin;
    const template: SeriesTemplate = { ...series.template, ...fields, endOffsetMin };
    const fromIndex = scope === "all" ? 1 : occ.series_index;
    const split = scope === "following" && fromIndex > 1;

    if (!split && !ruleChanged && shift === 0) {
      // Só campos: altera as pendentes no lugar.
      updateRow(db, ctx, "activity_series", series.id, { template: JSON.stringify(template) });
      for (const p of pendingFrom(db, series.id, fromIndex)) {
        const due = one<{ due_at: string }>(db, "SELECT due_at FROM activity WHERE id = ?", p.id)!.due_at;
        updateActivity(db, ctx, p.id, {
          ...fields,
          ...(patch.endAt !== undefined ? { endAt: endOffsetMin != null ? new Date(new Date(due).getTime() + endOffsetMin * 60_000).toISOString() : null } : {}),
        });
      }
      return;
    }

    for (const p of pendingFrom(db, series.id, fromIndex)) softDeleteWithNotes(db, ctx, p.id);
    if (split) {
      updateRow(db, ctx, "activity_series", series.id, { stop_index: fromIndex - 1 });
      const used = fromIndex - 1;
      const end = rule.end.type === "count" && !ruleChanged ? { type: "count" as const, count: Math.max(1, rule.end.count - used) } : rule.end;
      const id = insertRow(db, ctx, "activity_series", {
        rule: JSON.stringify({ ...rule, end }),
        start_at: newDue.toISOString(),
        from_at: newDue < startOfToday(now) ? startOfToday(now).toISOString() : newDue.toISOString(),
        template: JSON.stringify(template),
        skipped: "[]",
        stop_index: null,
      });
      topUpSeries(db, ctx, id, now);
    } else {
      const start = new Date(new Date(series.startAt).getTime() + shift);
      const from = new Date(new Date(series.fromAt).getTime() + shift);
      updateRow(db, ctx, "activity_series", series.id, {
        rule: JSON.stringify(rule),
        start_at: start.toISOString(),
        from_at: from.toISOString(),
        template: JSON.stringify(template),
        // Regra nova: os índices mudam de sentido; as exclusões avulsas deixam de valer.
        skipped: ruleChanged || shift !== 0 ? "[]" : JSON.stringify(series.skipped),
      });
      topUpSeries(db, ctx, series.id, now);
    }
  });
}

/** Excluir só esta, esta e as próximas, ou todas (pendentes); tudo pela lixeira. */
export function deleteFromSeries(db: DatabaseSync, ctx: DbContext, activityId: string, scope: SeriesScope): TrashNotice {
  const { occ, series } = occurrenceOf(db, activityId);
  if (scope === "this") {
    return moveToTrash(db, ctx, "activity", activityId, () => {
      updateRow(db, ctx, "activity_series", series.id, { skipped: JSON.stringify([...new Set([...series.skipped, occ.series_index])]) });
      softDeleteWithNotes(db, ctx, activityId);
    });
  }
  return moveToTrash(db, ctx, "activity", activityId, () => {
    const fromIndex = scope === "all" ? 1 : occ.series_index;
    for (const p of pendingFrom(db, series.id, fromIndex)) softDeleteWithNotes(db, ctx, p.id);
    if (!one(db, "SELECT 1 FROM activity WHERE id = ? AND deleted_at IS NOT NULL", activityId)) softDeleteWithNotes(db, ctx, activityId);
    if (scope === "all" || fromIndex === 1) softDelete(db, ctx, "activity_series", series.id);
    else updateRow(db, ctx, "activity_series", series.id, { stop_index: fromIndex - 1 });
  });
}

/** "Encerrar série": passa a ter data final; as pendentes depois dela saem. */
export function endSeries(db: DatabaseSync, ctx: DbContext, seriesId: string, date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("Data final inválida.");
  return withTransaction(db, () => {
    const s = getSeries(db, seriesId);
    if (!s) throw new ValidationError("Recorrência não encontrada.");
    updateRow(db, ctx, "activity_series", s.id, { rule: JSON.stringify({ ...s.rule, end: { type: "until", date } }) });
    let n = 0;
    for (const o of activeOccurrences(db, s.id)) {
      if (o.done || localDate(new Date(o.due_at)) <= date) continue;
      softDeleteWithNotes(db, ctx, o.id);
      n++;
    }
    return n;
  });
}

/** Para a tela: a regra da série de uma atividade. */
export function seriesOfActivity(db: DatabaseSync, activityId: string): (Series & { index: number; total: number | null }) | null {
  const a = one<{ series_id: string | null; series_index: number | null }>(db, "SELECT series_id, series_index FROM activity WHERE id = ?", activityId);
  if (!a?.series_id) return null;
  const s = getSeries(db, a.series_id);
  if (!s) return null;
  return { ...s, index: a.series_index ?? 0, total: s.rule.end.type === "count" ? s.rule.end.count : null };
}

/** Exclusão comum (fora da série) de uma ocorrência continua valendo: vira "só esta". */
export function deleteActivityOrOccurrence(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  const a = one<{ series_id: string | null }>(db, "SELECT series_id FROM activity WHERE id = ?", id);
  return a?.series_id ? deleteFromSeries(db, ctx, id, "this") : deleteActivity(db, ctx, id);
}
