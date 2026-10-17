// Tarefas (spec 02) e tipos de tarefa. O vínculo com negócio/ticket/projeto
// ("Vinculado a") é opcional.
import { nowIso } from "../lib/ids";
import { normalizeIsoDate, optionalText, requireText, ValidationError } from "../lib/validate";
import { getCustomValues, setCustomValues, type CustomValue } from "./customFields";
import { getCardRow } from "./deals";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { getUser, teammateIds, type Viewer } from "./users";

export interface ActivityType {
  id: string;
  name: string;
  icon: string;
  is_meeting: number;
  position: number;
  active: number;
}

export function listActivityTypes(db: DatabaseSync, opts: { includeInactive?: boolean } = {}): ActivityType[] {
  return many<ActivityType>(
    db,
    `SELECT id, name, icon, is_meeting, position, active FROM activity_type
     WHERE deleted_at IS NULL ${opts.includeInactive ? "" : "AND active = 1"} ORDER BY position`,
  );
}

export function createActivityType(db: DatabaseSync, ctx: DbContext, input: { name: string; icon: string; isMeeting?: boolean }): string {
  const last = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM activity_type WHERE deleted_at IS NULL");
  return insertRow(db, ctx, "activity_type", {
    name: requireText(input.name, "Informe o nome do tipo."),
    icon: requireText(input.icon, "Escolha um ícone."),
    is_meeting: input.isMeeting ? 1 : 0,
    position: (last?.p ?? -1) + 1,
  });
}

export function updateActivityType(
  db: DatabaseSync,
  ctx: DbContext,
  id: string,
  patch: { name?: string; icon?: string; isMeeting?: boolean; active?: boolean; position?: number },
): void {
  const data: Record<string, SqlValue> = {};
  if (patch.name !== undefined) data.name = requireText(patch.name, "Informe o nome do tipo.");
  if (patch.icon !== undefined) data.icon = requireText(patch.icon, "Escolha um ícone.");
  if (patch.isMeeting !== undefined) data.is_meeting = patch.isMeeting ? 1 : 0;
  if (patch.position !== undefined) data.position = patch.position;
  if (patch.active !== undefined) {
    if (!patch.active && listActivityTypes(db).filter((t) => t.id !== id).length === 0) {
      throw new ValidationError("É preciso manter pelo menos um tipo de tarefa ativo.");
    }
    data.active = patch.active ? 1 : 0;
  }
  updateRow(db, ctx, "activity_type", id, data);
}

/** Tipo padrão do formulário: "Tarefa" (spec 02), ou o primeiro ativo. */
export function defaultActivityTypeId(db: DatabaseSync): string {
  const types = listActivityTypes(db);
  const t = types.find((x) => x.name === "Tarefa") ?? types[0];
  if (!t) throw new ValidationError("Cadastre um tipo de tarefa.");
  return t.id;
}

export interface ActivityInput {
  typeId?: string;
  title: string;
  description?: string | null;
  /** Padrão: agora. */
  dueAt?: string | null;
  durationMin?: number;
  reminderMin?: number | null;
  done?: boolean;
  ownerId?: string | null;
  /** "Vinculado a": negócio, ticket ou etapa de projeto (opcional). */
  dealId?: string | null;
  personId?: string | null;
  organizationId?: string | null;
  customValues?: Record<string, CustomValue>;
}

export interface Activity {
  id: string;
  type_id: string;
  title: string;
  description: string | null;
  due_at: string;
  duration_min: number;
  reminder_min: number | null;
  done: number;
  done_at: string | null;
  owner_id: string | null;
  deal_id: string | null;
  person_id: string | null;
  organization_id: string | null;
  external_provider: string | null;
  external_event_id: string | null;
  meeting_url: string | null;
  /** JSON com os e-mails convidados. */
  guests: string | null;
  reminder_sent_at: string | null;
  version: number;
}

export interface ActivityListItem extends Activity {
  type_name: string;
  type_icon: string;
  deal_title: string | null;
  deal_kind: string | null;
  person_name: string | null;
  organization_name: string | null;
  owner_name: string | null;
}

function minutes(value: number | null | undefined, label: string, allowNull: boolean): number | null {
  if (value == null) {
    if (allowNull) return null;
    throw new ValidationError(`${label}: informe os minutos.`);
  }
  if (!Number.isInteger(value) || value < 0 || value > 60 * 24 * 30) throw new ValidationError(`${label}: valor inválido.`);
  return value;
}

function checkType(db: DatabaseSync, typeId: string): string {
  if (!one(db, "SELECT 1 FROM activity_type WHERE id = ? AND deleted_at IS NULL", typeId)) throw new ValidationError("Tipo de tarefa não encontrado.");
  return typeId;
}

function links(db: DatabaseSync, input: Partial<ActivityInput>, current?: Activity): Record<string, SqlValue> {
  const data: Record<string, SqlValue> = {};
  if (input.dealId !== undefined) {
    if (input.dealId) {
      const card = getCardRow(db, input.dealId);
      if (!card) throw new ValidationError("Negócio, ticket ou projeto não encontrado.");
      data.deal_id = card.id;
      // Herda contato e organização do cartão quando não informados.
      if (input.personId === undefined && !current?.person_id) data.person_id = card.person_id;
      if (input.organizationId === undefined && !current?.organization_id) data.organization_id = card.organization_id;
    } else data.deal_id = null;
  }
  if (input.personId !== undefined) {
    if (input.personId && !getRow(db, "person", input.personId)) throw new ValidationError("Contato não encontrado.");
    data.person_id = input.personId ?? null;
  }
  if (input.organizationId !== undefined) {
    if (input.organizationId && !getRow(db, "organization", input.organizationId)) throw new ValidationError("Organização não encontrada.");
    data.organization_id = input.organizationId ?? null;
  }
  return data;
}

export function createActivity(db: DatabaseSync, ctx: DbContext, input: ActivityInput): string {
  return withTransaction(db, () => {
    const ownerId = input.ownerId === undefined ? ctx.userId : input.ownerId;
    if (ownerId && !getUser(db, ownerId)) throw new ValidationError("Responsável não encontrado.");
    const done = !!input.done;
    const id = insertRow(db, ctx, "activity", {
      type_id: checkType(db, input.typeId ?? defaultActivityTypeId(db)),
      title: requireText(input.title, "Informe o nome da tarefa."),
      description: optionalText(input.description),
      due_at: normalizeIsoDate(input.dueAt, "Quando") ?? nowIso(),
      duration_min: minutes(input.durationMin ?? 5, "Duração", false),
      reminder_min: minutes(input.reminderMin === undefined ? 5 : input.reminderMin, "Lembrete", true),
      done: done ? 1 : 0,
      done_at: done ? nowIso() : null,
      owner_id: ownerId,
      deal_id: null,
      person_id: null,
      organization_id: null,
      ...links(db, { dealId: input.dealId ?? null, personId: input.personId, organizationId: input.organizationId }),
    });
    setCustomValues(db, ctx, "activity", id, input.customValues ?? {}, { checkRequired: true });
    return id;
  });
}

export function getActivity(db: DatabaseSync, id: string): (Activity & { customValues: Record<string, CustomValue> }) | undefined {
  const a = one<Activity>(db, "SELECT * FROM activity WHERE id = ? AND deleted_at IS NULL", id);
  return a ? { ...a, customValues: getCustomValues(db, id) } : undefined;
}

export function updateActivity(db: DatabaseSync, ctx: DbContext, id: string, patch: Partial<ActivityInput>): void {
  withTransaction(db, () => {
    const current = getActivity(db, id);
    if (!current) throw new ValidationError("Tarefa não encontrada.");
    const data: Record<string, SqlValue> = links(db, patch, current);
    if (patch.typeId !== undefined) data.type_id = checkType(db, patch.typeId);
    if (patch.title !== undefined) data.title = requireText(patch.title, "Informe o nome da tarefa.");
    if (patch.description !== undefined) data.description = optionalText(patch.description);
    if (patch.dueAt !== undefined) data.due_at = normalizeIsoDate(patch.dueAt, "Quando") ?? current.due_at;
    // Mudou a data ou o lembrete: o lembrete volta a valer.
    if ((data.due_at !== undefined && data.due_at !== current.due_at) || (patch.reminderMin !== undefined && patch.reminderMin !== current.reminder_min)) {
      data.reminder_sent_at = null;
    }
    if (patch.durationMin !== undefined) data.duration_min = minutes(patch.durationMin, "Duração", false);
    if (patch.reminderMin !== undefined) data.reminder_min = minutes(patch.reminderMin, "Lembrete", true);
    if (patch.ownerId !== undefined) {
      if (patch.ownerId && !getUser(db, patch.ownerId)) throw new ValidationError("Responsável não encontrado.");
      data.owner_id = patch.ownerId;
    }
    if (patch.done !== undefined && !!patch.done !== !!current.done) {
      data.done = patch.done ? 1 : 0;
      data.done_at = patch.done ? nowIso() : null;
    }
    updateRow(db, ctx, "activity", id, data);
    if (patch.customValues) setCustomValues(db, ctx, "activity", id, patch.customValues, { checkRequired: true });
  });
}

export function setActivityDone(db: DatabaseSync, ctx: DbContext, id: string, done: boolean): void {
  updateActivity(db, ctx, id, { done });
}

export function deleteActivity(db: DatabaseSync, ctx: DbContext, id: string): void {
  softDelete(db, ctx, "activity", id);
}

export interface ActivityFilter {
  from?: string;
  to?: string;
  done?: boolean;
  /** Pendentes com data/hora já passada. */
  overdue?: boolean;
  ownerIds?: string[];
  typeId?: string;
  dealId?: string;
  personId?: string;
  organizationId?: string;
  /** Texto no título ou descrição. */
  search?: string;
  /** Permissão por tipo de usuário (mesma regra dos cartões). */
  viewer?: Viewer | null;
  limit?: number;
  offset?: number;
}

/** Administrador vê todas; gestor, as da equipe; vendedor, as suas. Sem responsável: todos. */
export function activityScope(db: DatabaseSync, viewer: Viewer | null | undefined): { sql: string; params: SqlValue[] } {
  if (!viewer || viewer.role === "admin") return { sql: "", params: [] };
  const ids = viewer.role === "gestor" ? teammateIds(db, viewer.id) : [viewer.id];
  return { sql: `(a.owner_id IS NULL OR a.owner_id IN (${ids.map(() => "?").join(", ")}))`, params: ids };
}

function activityWhere(db: DatabaseSync, f: ActivityFilter): { sql: string; params: SqlValue[] } {
  const where = ["a.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  const add = (sql: string, ...p: SqlValue[]) => {
    where.push(sql);
    params.push(...p);
  };
  const scope = activityScope(db, f.viewer);
  if (scope.sql) add(scope.sql, ...scope.params);
  if (f.search?.trim()) add("(a.title LIKE ? OR a.description LIKE ?)", `%${f.search.trim()}%`, `%${f.search.trim()}%`);
  if (f.from) add("a.due_at >= ?", new Date(f.from).toISOString());
  if (f.to) add("a.due_at < ?", new Date(f.to).toISOString());
  if (f.done !== undefined) add("a.done = ?", f.done ? 1 : 0);
  if (f.overdue) add("a.done = 0 AND a.due_at < ?", nowIso());
  if (f.ownerIds?.length) add(`a.owner_id IN (${f.ownerIds.map(() => "?").join(", ")})`, ...f.ownerIds);
  if (f.typeId) add("a.type_id = ?", f.typeId);
  if (f.dealId) add("a.deal_id = ?", f.dealId);
  if (f.personId) add("a.person_id = ?", f.personId);
  if (f.organizationId) add("a.organization_id = ?", f.organizationId);
  return { sql: where.join(" AND "), params };
}

export function listActivities(db: DatabaseSync, f: ActivityFilter = {}): ActivityListItem[] {
  const { sql, params } = activityWhere(db, f);
  return many<ActivityListItem>(
    db,
    `SELECT a.*, t.name AS type_name, t.icon AS type_icon, d.title AS deal_title, d.kind AS deal_kind,
       p.name AS person_name, o.name AS organization_name, u.name AS owner_name
     FROM activity a
     JOIN activity_type t ON t.id = a.type_id
     LEFT JOIN deal d ON d.id = a.deal_id AND d.deleted_at IS NULL
     LEFT JOIN person p ON p.id = a.person_id
     LEFT JOIN organization o ON o.id = a.organization_id
     LEFT JOIN app_user u ON u.id = a.owner_id
     WHERE ${sql}
     ORDER BY a.done, a.due_at LIMIT ? OFFSET ?`,
    ...params,
    f.limit ?? 200,
    f.offset ?? 0,
  );
}

/** Contadores dos cartões de alerta da tela de Tarefas (pendentes). */
export function activityCounters(db: DatabaseSync, f: Omit<ActivityFilter, "from" | "to" | "done" | "overdue"> = {}, now = new Date()) {
  const { sql, params } = activityWhere(db, { ...f, done: false });
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startToday.getTime() + 86400_000);
  const in7 = new Date(startToday.getTime() + 8 * 86400_000);
  const count = (extra: string, ...p: SqlValue[]) =>
    one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM activity a WHERE ${sql} AND ${extra}`, ...params, ...p)?.n ?? 0;
  return {
    overdue: count("a.due_at < ?", now.toISOString()),
    today: count("a.due_at >= ? AND a.due_at < ?", startToday.toISOString(), startTomorrow.toISOString()),
    next7: count("a.due_at >= ? AND a.due_at < ?", startTomorrow.toISOString(), in7.toISOString()),
  };
}

/** Lembretes a disparar agora para o usuário desta instalação (ou tarefas sem responsável).
 * Ignora tarefas vencidas há mais de 1 dia (não notifica o passado ao abrir o Chrome). */
export function dueReminders(db: DatabaseSync, userId: string | null, now = new Date()): Activity[] {
  const rows = many<Activity>(
    db,
    `SELECT * FROM activity WHERE deleted_at IS NULL AND done = 0 AND reminder_min IS NOT NULL AND reminder_sent_at IS NULL
       AND due_at > ? AND (owner_id IS NULL OR owner_id = ?)`,
    new Date(now.getTime() - 86400_000).toISOString(),
    userId,
  );
  return rows.filter((a) => new Date(a.due_at).getTime() - (a.reminder_min ?? 0) * 60_000 <= now.getTime());
}

export function markReminded(db: DatabaseSync, ctx: DbContext, ids: string[]): void {
  const at = nowIso();
  withTransaction(db, () => ids.forEach((id) => updateRow(db, ctx, "activity", id, { reminder_sent_at: at })));
}

/** Evento criado no Google Agenda / Outlook para esta tarefa. */
export function setActivityExternalEvent(
  db: DatabaseSync,
  ctx: DbContext,
  id: string,
  ev: { provider: "google" | "microsoft"; eventId: string; meetingUrl?: string | null; guests?: string[] },
): void {
  updateRow(db, ctx, "activity", id, {
    external_provider: ev.provider,
    external_event_id: ev.eventId,
    meeting_url: ev.meetingUrl ?? null,
    guests: ev.guests?.length ? JSON.stringify(ev.guests) : null,
  });
}
