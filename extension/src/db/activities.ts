// Tarefas (spec 02) e tipos de tarefa. O vínculo com negócio/ticket/projeto
// ("Vinculado a") é opcional.
import { nowIso } from "../lib/ids";
import { normalizeIsoDate, optionalText, requireText, ValidationError } from "../lib/validate";
import { getCustomValues, setCustomValues, type CustomValue } from "./customFields";
import { getCardRow } from "./deals";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { many, one, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { getUser } from "./users";

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
  limit?: number;
  offset?: number;
}

export function listActivities(db: DatabaseSync, f: ActivityFilter = {}): ActivityListItem[] {
  const where = ["a.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  const add = (sql: string, ...p: SqlValue[]) => {
    where.push(sql);
    params.push(...p);
  };
  if (f.from) add("a.due_at >= ?", new Date(f.from).toISOString());
  if (f.to) add("a.due_at < ?", new Date(f.to).toISOString());
  if (f.done !== undefined) add("a.done = ?", f.done ? 1 : 0);
  if (f.overdue) add("a.done = 0 AND a.due_at < ?", nowIso());
  if (f.ownerIds?.length) add(`a.owner_id IN (${f.ownerIds.map(() => "?").join(", ")})`, ...f.ownerIds);
  if (f.typeId) add("a.type_id = ?", f.typeId);
  if (f.dealId) add("a.deal_id = ?", f.dealId);
  if (f.personId) add("a.person_id = ?", f.personId);
  if (f.organizationId) add("a.organization_id = ?", f.organizationId);
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
     WHERE ${where.join(" AND ")}
     ORDER BY a.done, a.due_at LIMIT ? OFFSET ?`,
    ...params,
    f.limit ?? 200,
    f.offset ?? 0,
  );
}
