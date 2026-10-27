// Cartões do Kanban (spec 01): negócio (funil comercial), ticket
// (operacional) e etapa de projeto. Uma tabela só, com o tipo herdado do funil.
import { nowIso } from "../lib/ids";
import { normalizeCents, normalizeIsoDate, optionalText, requireText, ValidationError } from "../lib/validate";
import { primaryOrganizationId } from "./contacts";
import { getCustomField, getCustomValues, listCustomFields, setCustomValues, type CustomValue } from "./customFields";
import { KIND_BY_PIPELINE_TYPE, type DealKind, type PipelineType } from "./pipelines";
import { getProduct, RECURRENCES, type Recurrence } from "./products";
import { cardFieldValues, type CardFieldValue } from "./cardFieldValues";
import { isCardFieldKey } from "../lib/cardFields";
import { normalizeText } from "../lib/search";
import { OVERDUE_COND, overdueParams, startOfDay } from "../lib/taskTiming";
import { getRow, insertRow, softDelete, updateRow, type DbContext } from "./repo";
import { moveToTrash, type TrashNotice } from "./trash";
import { many, one, withTransaction, type DatabaseSync, type SqlValue } from "./sql";
import { createTag, getEntityTags, setEntityTags, type Tag } from "./tags";
import { getUser, teammateIds, type Viewer } from "./users";
import { copyCardContacts, listCardContacts, type CardContact } from "./cardContacts";
import { attachExtras, nameExtras, withExtra } from "./nameExtras";
import type { CustomFieldEntity } from "./customFields";

export type DealStatus = "open" | "won" | "lost";

const TITLE_REQUIRED: Record<DealKind, string> = {
  deal: "Informe o nome da negociação.",
  ticket: "Informe o título do ticket.",
  project: "Informe o título da etapa.",
};

export interface DealItemInput {
  id?: string;
  productId?: string | null;
  description?: string | null;
  quantity?: number;
  unitPriceCents?: number;
  discountCents?: number;
  recurrence?: Recurrence;
}

export interface CardInput {
  pipelineId: string;
  /** Sem etapa, entra na primeira etapa do funil. */
  stageId?: string;
  title: string;
  description?: string | null;
  valueCents?: number;
  items?: DealItemInput[];
  slaAt?: string | null;
  startAt?: string | null;
  dueAt?: string | null;
  expectedCloseAt?: string | null;
  personId?: string | null;
  /** Não informado: usa a organização principal do contato (spec 04). */
  organizationId?: string | null;
  ownerId?: string | null;
  origin?: string | null;
  tagIds?: string[];
  customValues?: Record<string, CustomValue>;
}

export interface Card {
  id: string;
  kind: DealKind;
  pipeline_id: string;
  stage_id: string;
  position: number;
  title: string;
  description: string | null;
  value_cents: number;
  value_from_items: number;
  sla_at: string | null;
  start_at: string | null;
  due_at: string | null;
  expected_close_at: string | null;
  person_id: string | null;
  organization_id: string | null;
  owner_id: string | null;
  status: DealStatus;
  /** Arquivado: fora do quadro (filtro "Arquivados"), mas nos relatórios. */
  archived_at: string | null;
  loss_reason_id: string | null;
  loss_note: string | null;
  closed_at: string | null;
  stage_entered_at: string;
  origin: string | null;
  /** Só nos tickets (funil Operacional): número sequencial. */
  ticket_number: number | null;
  /** "Não registrar no financeiro" (escolhido ao ganhar/concluir). */
  finance_skip: number;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface DealItem {
  id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  total_cents: number;
  recurrence: Recurrence;
}

export interface CardDetail extends Card {
  /** Contatos do cartão: o principal primeiro, depois os demais. */
  contacts: CardContact[];
  person_name: string | null;
  organization_name: string | null;
  /** Campos marcados para aparecer junto com o título. */
  title_ext: string | null;
  loss_reason_name: string | null;
  items: DealItem[];
  tags: Tag[];
  customValues: Record<string, CustomValue>;
  stageHistory: { stage_id: string; stage_name: string; entered_at: string; left_at: string | null }[];
}

function pipelineOf(db: DatabaseSync, pipelineId: string): { id: string; type: PipelineType; archived_at: string | null } {
  const p = one<{ id: string; type: PipelineType; archived_at: string | null }>(
    db,
    "SELECT id, type, archived_at FROM pipeline WHERE id = ? AND deleted_at IS NULL",
    pipelineId,
  );
  if (!p) throw new ValidationError("Funil não encontrado.");
  return p;
}

function stageOf(db: DatabaseSync, stageId: string): { id: string; pipeline_id: string; name: string } {
  const s = one<{ id: string; pipeline_id: string; name: string }>(db, "SELECT id, pipeline_id, name FROM stage WHERE id = ? AND deleted_at IS NULL", stageId);
  if (!s) throw new ValidationError("Etapa não encontrada.");
  return s;
}

function firstStageId(db: DatabaseSync, pipelineId: string): string {
  const s = one<{ id: string }>(db, "SELECT id FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position LIMIT 1", pipelineId);
  if (!s) throw new ValidationError("O funil não tem etapas.");
  return s.id;
}

function checkRef(db: DatabaseSync, table: "person" | "organization" | "app_user", id: string | null | undefined, message: string): string | null {
  if (!id) return null;
  if (!getRow(db, table, id)) throw new ValidationError(message);
  return id;
}

/** Campos próprios de cada tipo (spec 01, seção 2): o que não se aplica é recusado. */
function checkKindFields(kind: DealKind, input: Partial<CardInput>): void {
  const reject = (cond: boolean, what: string) => {
    if (cond) throw new ValidationError(`${what} não se aplica a este tipo de funil.`);
  };
  reject(kind !== "deal" && !!input.expectedCloseAt, "Data prevista de fechamento");
  reject(kind !== "ticket" && !!input.slaAt, "SLA");
  reject(kind !== "project" && (!!input.startAt || !!input.dueAt), "Início/prazo");
}

/** "234525", "#234525" ou "Ticket: 234525" → 234525 (busca pelo número do ticket). */
export function ticketNumberQuery(text: string): number | null {
  const m = text.trim().match(/^(?:ticket\s*:?\s*)?#?\s*(\d{1,12})$/i);
  return m ? Number(m[1]) : null;
}

/** Próximo número de ticket (contando os excluídos, para não repetir). */
function nextTicketNumber(db: DatabaseSync): number {
  return (one<{ n: number | null }>(db, "SELECT MAX(ticket_number) AS n FROM deal")?.n ?? 0) + 1;
}

function columnEdgePosition(db: DatabaseSync, stageId: string, edge: "top" | "bottom", exceptId = ""): number {
  const r = one<{ p: number | null }>(
    db,
    `SELECT ${edge === "top" ? "MIN" : "MAX"}(position) AS p FROM deal WHERE stage_id = ? AND deleted_at IS NULL AND id <> ?`,
    stageId,
    exceptId,
  );
  if (r?.p == null) return 0;
  return edge === "top" ? r.p - 1 : r.p + 1;
}

// ---------- Permissão por tipo de usuário ----------
// Administrador vê tudo; gestor vê os cartões da(s) sua(s) equipe(s);
// vendedor vê só os seus. Cartões sem responsável ficam visíveis a todos.

export function cardScope(db: DatabaseSync, viewer: Viewer | null | undefined, alias = "d"): { sql: string; params: SqlValue[] } {
  if (!viewer || viewer.role === "admin") return { sql: "", params: [] };
  const ids = viewer.role === "gestor" ? teammateIds(db, viewer.id) : [viewer.id];
  return {
    sql: ` AND (${alias}.owner_id IS NULL OR ${alias}.owner_id IN (${ids.map(() => "?").join(", ")}))`,
    params: ids,
  };
}

export function canAccessCard(db: DatabaseSync, viewer: Viewer | null | undefined, id: string): boolean {
  const scope = cardScope(db, viewer);
  return !!one(db, `SELECT 1 FROM deal d WHERE d.id = ? AND d.deleted_at IS NULL${scope.sql}`, id, ...scope.params);
}

export function assertCardAccess(db: DatabaseSync, viewer: Viewer | null | undefined, id: string): void {
  if (!canAccessCard(db, viewer, id)) throw new ValidationError("Cartão não encontrado ou sem permissão de acesso.");
}

/** Vendedor só atribui a si mesmo; gestor, a alguém da equipe. */
export function assertCanAssign(db: DatabaseSync, viewer: Viewer | null | undefined, ownerId: string | null | undefined): void {
  if (!viewer || viewer.role === "admin" || !ownerId) return;
  const allowed = viewer.role === "gestor" ? teammateIds(db, viewer.id) : [viewer.id];
  if (!allowed.includes(ownerId)) {
    throw new ValidationError(
      viewer.role === "vendedor" ? "Vendedor só pode atribuir cartões a si mesmo." : "Gestor só pode atribuir cartões a pessoas da sua equipe.",
    );
  }
}

export function createCard(db: DatabaseSync, ctx: DbContext, input: CardInput): string {
  return withTransaction(db, () => {
    const pipeline = pipelineOf(db, input.pipelineId);
    if (pipeline.archived_at) throw new ValidationError("Este funil está arquivado.");
    const kind = KIND_BY_PIPELINE_TYPE[pipeline.type];
    checkKindFields(kind, input);
    const stageId = input.stageId ?? firstStageId(db, pipeline.id);
    if (stageOf(db, stageId).pipeline_id !== pipeline.id) throw new ValidationError("A etapa não pertence a este funil.");
    const personId = checkRef(db, "person", input.personId, "Contato não encontrado.");
    const organizationId =
      input.organizationId === undefined
        ? personId
          ? primaryOrganizationId(db, personId)
          : null
        : checkRef(db, "organization", input.organizationId, "Organização não encontrada.");
    const ownerId = input.ownerId === undefined ? ctx.userId : input.ownerId;
    if (ownerId && !getUser(db, ownerId)) throw new ValidationError("Responsável não encontrado.");
    const at = nowIso();
    const id = insertRow(db, ctx, "deal", {
      kind,
      pipeline_id: pipeline.id,
      stage_id: stageId,
      position: columnEdgePosition(db, stageId, "top"),
      title: requireText(input.title, TITLE_REQUIRED[kind]),
      description: optionalText(input.description),
      value_cents: normalizeCents(input.valueCents, "Valor"),
      sla_at: normalizeIsoDate(input.slaAt, "SLA"),
      start_at: normalizeIsoDate(input.startAt, "Início"),
      due_at: normalizeIsoDate(input.dueAt, "Prazo"),
      expected_close_at: normalizeIsoDate(input.expectedCloseAt, "Previsão de fechamento"),
      person_id: personId,
      organization_id: organizationId,
      owner_id: ownerId,
      stage_entered_at: at,
      origin: optionalText(input.origin),
      ...(kind === "ticket" ? { ticket_number: nextTicketNumber(db) } : {}),
    });
    insertRow(db, ctx, "deal_stage_history", { deal_id: id, stage_id: stageId, entered_at: at });
    if (input.items?.length) setDealItems(db, ctx, id, input.items);
    if (input.tagIds) setEntityTags(db, ctx, kind, id, input.tagIds);
    setCustomValues(db, ctx, kind, id, input.customValues ?? {}, { pipelineId: pipeline.id, checkRequired: true });
    return id;
  });
}

export function getCardRow(db: DatabaseSync, id: string): Card | undefined {
  return one<Card>(db, "SELECT * FROM deal WHERE id = ? AND deleted_at IS NULL", id);
}

function requireCard(db: DatabaseSync, id: string): Card {
  const card = getCardRow(db, id);
  if (!card) throw new ValidationError("Cartão não encontrado.");
  return card;
}

/** Atualiza dados do cartão. Etapa/funil mudam por `moveCard`; status por `setCardStatus`.
 * Informar `valueCents` desvincula o valor da soma dos produtos. */
export function updateCard(
  db: DatabaseSync,
  ctx: DbContext,
  id: string,
  patch: Partial<Omit<CardInput, "pipelineId" | "stageId" | "items">>,
): void {
  withTransaction(db, () => {
    const card = requireCard(db, id);
    checkKindFields(card.kind, patch);
    const data: Record<string, SqlValue> = {};
    if (patch.title !== undefined) data.title = requireText(patch.title, TITLE_REQUIRED[card.kind]);
    if (patch.description !== undefined) data.description = optionalText(patch.description);
    if (patch.valueCents !== undefined) {
      data.value_cents = normalizeCents(patch.valueCents, "Valor");
      data.value_from_items = 0;
    }
    if (patch.slaAt !== undefined) data.sla_at = normalizeIsoDate(patch.slaAt, "SLA");
    if (patch.startAt !== undefined) data.start_at = normalizeIsoDate(patch.startAt, "Início");
    if (patch.dueAt !== undefined) data.due_at = normalizeIsoDate(patch.dueAt, "Prazo");
    if (patch.expectedCloseAt !== undefined) data.expected_close_at = normalizeIsoDate(patch.expectedCloseAt, "Previsão de fechamento");
    if (patch.personId !== undefined) {
      data.person_id = checkRef(db, "person", patch.personId, "Contato não encontrado.");
      // Virou principal: sai de "outros contatos".
      const dup = data.person_id && one<{ id: string }>(db, "SELECT id FROM deal_participant WHERE deal_id = ? AND person_id = ? AND deleted_at IS NULL", id, data.person_id);
      if (dup) softDelete(db, ctx, "deal_participant", dup.id);
    }
    if (patch.organizationId !== undefined) data.organization_id = checkRef(db, "organization", patch.organizationId, "Organização não encontrada.");
    if (patch.ownerId !== undefined) data.owner_id = checkRef(db, "app_user", patch.ownerId, "Responsável não encontrado.");
    if (patch.origin !== undefined) data.origin = optionalText(patch.origin);
    updateRow(db, ctx, "deal", id, data);
    if (patch.tagIds) setEntityTags(db, ctx, card.kind, id, patch.tagIds);
    if (patch.customValues) setCustomValues(db, ctx, card.kind, id, patch.customValues, { pipelineId: card.pipeline_id, checkRequired: true });
  });
}

/** Move o cartão para uma etapa (do mesmo funil ou de outro funil do mesmo
 * tipo), antes do cartão `beforeId` ou no fim da coluna. Mudança de etapa
 * fica registrada em deal_stage_history. */
export function moveCard(db: DatabaseSync, ctx: DbContext, id: string, target: { stageId: string; beforeId?: string | null }, opts: { changeKind?: boolean } = {}): void {
  withTransaction(db, () => {
    const card = requireCard(db, id);
    const stage = stageOf(db, target.stageId);
    const pipeline = pipelineOf(db, stage.pipeline_id);
    const kind = KIND_BY_PIPELINE_TYPE[pipeline.type];
    // Arrastar só entre funis do mesmo tipo; "Mudar de funil" pode trocar o tipo.
    if (kind !== card.kind && !opts.changeKind) throw new ValidationError("Só é possível mover para um funil do mesmo tipo.");

    let position: number;
    if (target.beforeId) {
      const before = getCardRow(db, target.beforeId);
      if (!before || before.stage_id !== stage.id) throw new ValidationError("Posição de destino inválida.");
      const prev = one<{ p: number | null }>(
        db,
        "SELECT MAX(position) AS p FROM deal WHERE stage_id = ? AND position < ? AND deleted_at IS NULL AND id <> ?",
        stage.id,
        before.position,
        id,
      );
      position = prev?.p == null ? before.position - 1 : (prev.p + before.position) / 2;
    } else {
      position = columnEdgePosition(db, stage.id, "bottom", id);
    }

    const data: Record<string, SqlValue> = { position };
    if (stage.id !== card.stage_id) {
      const at = nowIso();
      const open = one<{ id: string }>(
        db,
        "SELECT id FROM deal_stage_history WHERE deal_id = ? AND left_at IS NULL AND deleted_at IS NULL ORDER BY entered_at DESC LIMIT 1",
        id,
      );
      if (open) updateRow(db, ctx, "deal_stage_history", open.id, { left_at: at });
      insertRow(db, ctx, "deal_stage_history", { deal_id: id, stage_id: stage.id, entered_at: at });
      Object.assign(data, { stage_id: stage.id, pipeline_id: pipeline.id, stage_entered_at: at });
    }
    if (kind !== card.kind) {
      data.kind = kind;
      // Virou ticket: ganha número (mantém o que já tinha, se voltar a ser ticket).
      if (kind === "ticket" && card.ticket_number == null) data.ticket_number = nextTicketNumber(db);
    }
    updateRow(db, ctx, "deal", id, data);
  });
}

/** Etapa do funil de destino com o mesmo nome (sem acento/maiúsculas) da etapa de origem. */
export function matchingStageId(db: DatabaseSync, fromStageId: string, pipelineId: string): string | null {
  const from = stageOf(db, fromStageId);
  const key = normalizeText(from.name);
  const target = many<{ id: string; name: string }>(db, "SELECT id, name FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position", pipelineId);
  return target.find((s) => normalizeText(s.name) === key)?.id ?? null;
}

/** Funil de destino e etapa: a informada ou a de mesmo nome; sem ela, pede a escolha. */
function resolveTarget(db: DatabaseSync, fromStageId: string, input: { pipelineId: string; stageId?: string | null }) {
  const target = pipelineOf(db, input.pipelineId);
  if (target.archived_at) throw new ValidationError("Este funil está arquivado.");
  const stageId = input.stageId ?? matchingStageId(db, fromStageId, target.id);
  if (!stageId) throw new ValidationError("O funil de destino não tem uma etapa com o mesmo nome. Escolha a etapa.");
  if (stageOf(db, stageId).pipeline_id !== target.id) throw new ValidationError("A etapa não pertence ao funil de destino.");
  return { target, kind: KIND_BY_PIPELINE_TYPE[target.type], stageId };
}

/** Tags do cartão no tipo de destino: as de mesmo nome; as que faltam são criadas (mesma cor). */
function tagsForKind(db: DatabaseSync, ctx: DbContext, cardId: string, kind: DealKind): string[] {
  return getEntityTags(db, cardId).map((t) => {
    if (t.entity === kind) return t.id;
    const same = many<{ id: string; name: string }>(db, "SELECT id, name FROM tag WHERE entity = ? AND deleted_at IS NULL", kind).find(
      (x) => normalizeText(x.name) === normalizeText(t.name),
    );
    return same?.id ?? createTag(db, ctx, { entity: kind, name: t.name, color: t.color ?? undefined });
  });
}

/**
 * Campos personalizados no destino: valor levado para o campo de mesmo nome e
 * tipo que vale no funil de destino (listas pelo rótulo da opção).
 */
function customValuesFor(db: DatabaseSync, cardId: string, kind: DealKind, pipelineId: string): Record<string, CustomValue> {
  const targets = listCustomFields(db, kind, { pipelineId });
  const out: Record<string, CustomValue> = {};
  for (const [fieldId, value] of Object.entries(getCustomValues(db, cardId))) {
    const from = getCustomField(db, fieldId);
    if (!from || value === null) continue;
    const to = targets.find((f) => f.field_type === from.field_type && normalizeText(f.name) === normalizeText(from.name));
    if (!to) continue;
    if (to.id === from.id) out[to.id] = value;
    else if (from.field_type === "select" || from.field_type === "multiselect") {
      const label = (id: string) => from.options.find((o) => o.id === id)?.label;
      const map = (id: string) => to.options.find((o) => normalizeText(o.label) === normalizeText(label(id) ?? "\u0000"))?.id;
      const ids = (Array.isArray(value) ? value : [String(value)]).map(map).filter((x): x is string => !!x);
      if (ids.length) out[to.id] = from.field_type === "multiselect" ? ids : ids[0]!;
    } else out[to.id] = value;
  }
  return out;
}

/**
 * Leva o cartão para outro funil, inclusive de outro tipo (negócio ↔ ticket ↔
 * etapa de projeto). Sem `stageId`, vai para a etapa de mesmo nome; se o destino
 * não tiver, é preciso escolher. Mudando de tipo, tags e campos personalizados
 * de mesmo nome são levados; os campos só do tipo antigo ficam guardados.
 */
export function changeCardPipeline(db: DatabaseSync, ctx: DbContext, id: string, input: { pipelineId: string; stageId?: string | null }): string {
  return withTransaction(db, () => {
    const card = requireCard(db, id);
    if (input.pipelineId === card.pipeline_id) throw new ValidationError("O cartão já está neste funil.");
    const { target, kind, stageId } = resolveTarget(db, card.stage_id, input);
    const changeKind = kind !== card.kind;
    const tags = changeKind ? tagsForKind(db, ctx, id, kind) : [];
    const custom = changeKind ? customValuesFor(db, id, kind, target.id) : {};
    moveCard(db, ctx, id, { stageId }, { changeKind });
    if (changeKind) {
      setEntityTags(db, ctx, kind, id, tags);
      setCustomValues(db, ctx, kind, id, custom, { pipelineId: target.id });
    }
    return stageId;
  });
}

/**
 * Cópia do cartão em qualquer funil (mesmas regras de etapa e tipo): título,
 * descrição, valor, produtos, contato, organização, responsável, origem, tags e
 * campos personalizados; datas próprias do tipo só se o tipo for o mesmo.
 * Atividades, notas, documentos e histórico não são copiados.
 */
export function cloneCard(db: DatabaseSync, ctx: DbContext, id: string, input: { pipelineId: string; stageId?: string | null; title?: string | null }): string {
  return withTransaction(db, () => {
    const card = requireCard(db, id);
    const { target, kind, stageId } = resolveTarget(db, card.stage_id, input);
    const same = kind === card.kind;
    const items = listDealItems(db, id);
    const newId = createCard(db, ctx, {
      pipelineId: target.id,
      stageId,
      title: input.title?.trim() || card.title,
      description: card.description,
      valueCents: items.length ? undefined : card.value_cents,
      items: items.map((i) => ({
        productId: i.product_id,
        description: i.description,
        quantity: i.quantity,
        unitPriceCents: i.unit_price_cents,
        discountCents: i.discount_cents,
        recurrence: i.recurrence,
      })),
      expectedCloseAt: same && kind === "deal" ? card.expected_close_at : null,
      slaAt: same && kind === "ticket" ? card.sla_at : null,
      startAt: same && kind === "project" ? card.start_at : null,
      dueAt: same && kind === "project" ? card.due_at : null,
      personId: card.person_id,
      organizationId: card.organization_id,
      ownerId: card.owner_id,
      origin: card.origin,
      tagIds: tagsForKind(db, ctx, id, kind),
      customValues: customValuesFor(db, id, kind, target.id),
    });
    copyCardContacts(db, ctx, id, newId);
    return newId;
  });
}

/** Ganho, perdido (com motivo) ou reaberto. */
export function setCardStatus(
  db: DatabaseSync,
  ctx: DbContext,
  id: string,
  input: { status: DealStatus; lossReasonId?: string | null; lossNote?: string | null },
): void {
  withTransaction(db, () => {
    requireCard(db, id);
    if (!["open", "won", "lost"].includes(input.status)) throw new ValidationError("Status inválido.");
    if (input.lossReasonId && !getRow(db, "loss_reason", input.lossReasonId)) throw new ValidationError("Motivo de perda não encontrado.");
    const lost = input.status === "lost";
    updateRow(db, ctx, "deal", id, {
      status: input.status,
      closed_at: input.status === "open" ? null : nowIso(),
      loss_reason_id: lost ? (input.lossReasonId ?? null) : null,
      loss_note: lost ? optionalText(input.lossNote) : null,
    });
  });
}

/** Para a lixeira, com as atividades e notas do cartão (voltam juntas ao restaurar). */
export function deleteCard(db: DatabaseSync, ctx: DbContext, id: string): TrashNotice {
  return moveToTrash(db, ctx, "deal", id, () => {
    for (const a of many<{ id: string }>(db, "SELECT id FROM activity WHERE deal_id = ? AND deleted_at IS NULL", id)) softDelete(db, ctx, "activity", a.id);
    for (const n of many<{ id: string }>(db, "SELECT id FROM note WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL", "deal", id))
      softDelete(db, ctx, "note", n.id);
    softDelete(db, ctx, "deal", id);
  });
}

// ---------- Itens (produtos e serviços) ----------

export function listDealItems(db: DatabaseSync, dealId: string): DealItem[] {
  return many<DealItem>(
    db,
    `SELECT id, product_id, description, quantity, unit_price_cents, discount_cents, total_cents, recurrence
     FROM deal_item WHERE deal_id = ? AND deleted_at IS NULL ORDER BY position`,
    dealId,
  );
}

/** Substitui os itens do cartão (qualquer tipo de funil); com itens, o valor passa a ser a soma (spec 01, seção 4). */
export function setDealItems(db: DatabaseSync, ctx: DbContext, dealId: string, items: DealItemInput[]): void {
  withTransaction(db, () => {
    const card = requireCard(db, dealId);
    const current = listDealItems(db, dealId);
    const keep = new Set(items.filter((i) => i.id).map((i) => i.id!));
    for (const row of current) if (!keep.has(row.id)) softDelete(db, ctx, "deal_item", row.id);
    let sum = 0;
    items.forEach((item, i) => {
      if (item.id && !current.some((c) => c.id === item.id)) throw new ValidationError("Item não encontrado.");
      const product = item.productId ? getProduct(db, item.productId) : undefined;
      if (item.productId && !product) throw new ValidationError("Produto não encontrado.");
      const quantity = item.quantity ?? 1;
      if (!(quantity > 0)) throw new ValidationError("Quantidade inválida.");
      const unit = normalizeCents(item.unitPriceCents ?? product?.price_cents ?? 0, "Preço");
      const discount = normalizeCents(item.discountCents, "Desconto");
      const total = Math.max(0, Math.round(quantity * unit) - discount);
      const recurrence = item.recurrence ?? product?.recurrence ?? "avulso";
      if (!RECURRENCES.includes(recurrence)) throw new ValidationError("Recorrência inválida.");
      const data = {
        product_id: product?.id ?? null,
        description: requireText(item.description ?? product?.name, "Informe a descrição do item."),
        quantity,
        unit_price_cents: unit,
        discount_cents: discount,
        total_cents: total,
        recurrence,
        position: i,
      };
      if (item.id) updateRow(db, ctx, "deal_item", item.id, data);
      else insertRow(db, ctx, "deal_item", { deal_id: dealId, ...data });
      sum += total;
    });
    if (items.length > 0) updateRow(db, ctx, "deal", dealId, { value_cents: sum, value_from_items: 1 });
    else if (card.value_from_items) updateRow(db, ctx, "deal", dealId, { value_from_items: 0 });
  });
}

// ---------- Leitura ----------

export function getCard(db: DatabaseSync, id: string, viewer?: Viewer | null): CardDetail | undefined {
  const card = getCardRow(db, id);
  if (!card || !canAccessCard(db, viewer, id)) return undefined;
  const names = one<{ person_name: string | null; organization_name: string | null; loss_reason_name: string | null }>(
    db,
    `SELECT (SELECT name FROM person WHERE id = ?) AS person_name, (SELECT name FROM organization WHERE id = ?) AS organization_name,
       (SELECT name FROM loss_reason WHERE id = ?) AS loss_reason_name`,
    card.person_id,
    card.organization_id,
    card.loss_reason_id,
  )!;
  const kindOf = card.kind as CustomFieldEntity;
  return {
    ...card,
    ...names,
    // Nomes com os campos marcados ("Maria José - Diretora").
    person_name: names.person_name && withExtra(names.person_name, nameExtras(db, "person", [card.person_id]).get(card.person_id ?? "")),
    organization_name: names.organization_name && withExtra(names.organization_name, nameExtras(db, "organization", [card.organization_id]).get(card.organization_id ?? "")),
    title_ext: nameExtras(db, kindOf, [id]).get(id) ?? null,
    contacts: attachExtras(db, "person", listCardContacts(db, id), "id", "name_ext"),
    items: listDealItems(db, id),
    tags: getEntityTags(db, id),
    customValues: getCustomValues(db, id),
    stageHistory: many(
      db,
      `SELECT h.stage_id, s.name AS stage_name, h.entered_at, h.left_at FROM deal_stage_history h
       JOIN stage s ON s.id = h.stage_id WHERE h.deal_id = ? AND h.deleted_at IS NULL ORDER BY h.entered_at`,
      id,
    ),
  };
}

export type BoardView = "all" | "mine" | "team";
export type BoardSort = "recent" | "manual" | "value" | "title" | "updated";

export interface BoardCard {
  id: string;
  title: string;
  /** Campos marcados para aparecer junto com o título (máx. 2). */
  title_ext: string | null;
  value_cents: number;
  status: DealStatus;
  person_id: string | null;
  organization_id: string | null;
  person_name: string | null;
  organization_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  sla_at: string | null;
  due_at: string | null;
  position: number;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  tasks_total: number;
  tasks_done: number;
  next_task_due_at: string | null;
  /** Indicador de atividades do cartão: atrasadas, de hoje (não atrasadas) e pendentes. */
  act_overdue: number;
  act_today: number;
  act_pending: number;
  notes_count: number;
  /** Outros contatos além do principal ("+2" no cartão). */
  extra_contacts: number;
  archived_at: string | null;
  /** Campos configurados no funil (lib/cardFields), já formatados. */
  fields: Record<string, CardFieldValue>;
}

export interface BoardColumn {
  id: string;
  name: string;
  color: string | null;
  count: number;
  total_cents: number;
  /** Atividades atrasadas dos cartões da etapa (relógio vermelho no cabeçalho). */
  overdue_activities: number;
  cards: BoardCard[];
}

const SORT_SQL: Record<BoardSort, string> = {
  recent: "d.created_at DESC",
  updated: "d.updated_at DESC",
  manual: "d.position",
  value: "d.value_cents DESC",
  title: "d.title COLLATE NOCASE",
};

/** Quadro do funil: colunas com quantidade, soma e cartões (spec 01, tela inicial).
 * Visões: *Fluxo geral* (all), *Meu fluxo* (mine), *Minha equipe* (team). */
/** Situação do filtro do quadro; "archived" mostra só os arquivados. */
export type BoardStatusFilter = DealStatus | "all" | "archived";
type BoardFilterOpts = { view?: BoardView; viewer?: Viewer | null; search?: string; status?: BoardStatusFilter; ownerIds?: string[]; tagIds?: string[] };

/** Condições do quadro (situação, visão, responsáveis, tags e pesquisa). */
function boardWhere(db: DatabaseSync, pipelineId: string, opts: BoardFilterOpts): { where: string[]; params: SqlValue[] } {
  const where = ["d.pipeline_id = ?", "d.deleted_at IS NULL"];
  const params: SqlValue[] = [pipelineId];
  const status = opts.status ?? "open";
  // "Todos" mostra também os arquivados (sinalizados em amarelo); "Arquivados", só eles.
  if (status === "archived") where.push("d.archived_at IS NOT NULL");
  else if (status !== "all") where.push("d.archived_at IS NULL");
  if (status !== "all" && status !== "archived") {
    where.push("d.status = ?");
    params.push(status);
  }
  const view = opts.view ?? "all";
  if (view !== "all") {
    if (!opts.viewer) throw new ValidationError("Selecione o usuário para ver o seu fluxo.");
    const ids = view === "mine" ? [opts.viewer.id] : teammateIds(db, opts.viewer.id);
    where.push(`d.owner_id IN (${ids.map(() => "?").join(", ")})`);
    params.push(...ids);
  }
  if (opts.ownerIds?.length) {
    where.push(`d.owner_id IN (${opts.ownerIds.map(() => "?").join(", ")})`);
    params.push(...opts.ownerIds);
  }
  if (opts.tagIds?.length) {
    where.push(`EXISTS (SELECT 1 FROM entity_tag et WHERE et.entity_id = d.id AND et.deleted_at IS NULL AND et.tag_id IN (${opts.tagIds.map(() => "?").join(", ")}))`);
    params.push(...opts.tagIds);
  }
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    const ticket = ticketNumberQuery(opts.search);
    // Também pelos outros contatos do cartão.
    where.push(
      `(d.title LIKE ? OR p.name LIKE ? OR o.name LIKE ?${ticket !== null ? " OR d.ticket_number = ?" : ""}
        OR EXISTS (SELECT 1 FROM deal_participant dp JOIN person pp ON pp.id = dp.person_id AND pp.deleted_at IS NULL
                   WHERE dp.deal_id = d.id AND dp.deleted_at IS NULL AND pp.name LIKE ?))`,
    );
    params.push(q, q, q, ...(ticket !== null ? [ticket] : []), q);
  }
  return { where, params };
}

/**
 * Quantos cartões o filtro de responsáveis/tags está escondendo (mesma
 * situação, visão e pesquisa): o quadro avisa para o cartão não "sumir".
 */
export function boardHiddenByFilter(db: DatabaseSync, pipelineId: string, opts: BoardFilterOpts): number {
  if (!opts.ownerIds?.length && !opts.tagIds?.length) return 0;
  const scope = cardScope(db, opts.viewer);
  const count = (o: BoardFilterOpts) => {
    const { where, params } = boardWhere(db, pipelineId, o);
    return (
      one<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM deal d LEFT JOIN person p ON p.id = d.person_id LEFT JOIN organization o ON o.id = d.organization_id
         WHERE ${where.join(" AND ")}${scope.sql}`,
        ...params,
        ...scope.params,
      )?.n ?? 0
    );
  };
  return count({ ...opts, ownerIds: [], tagIds: [] }) - count(opts);
}

export function getBoard(
  db: DatabaseSync,
  pipelineId: string,
  opts: {
    view?: BoardView;
    viewer?: Viewer | null;
    search?: string;
    status?: BoardStatusFilter;
    sort?: BoardSort;
    ownerIds?: string[];
    tagIds?: string[];
    /** Visão em lista: colunas escolhidas pelo usuário (no lugar dos campos do cartão). */
    fieldKeys?: string[];
  } = {},
): BoardColumn[] {
  const { where, params } = boardWhere(db, pipelineId, opts);
  const scope = cardScope(db, opts.viewer);
  const now = new Date();
  const today0 = startOfDay(now).toISOString();
  const today1 = new Date(startOfDay(now).getTime() + 86_400_000).toISOString();
  const cards = many<BoardCard & { stage_id: string }>(
    db,
    `SELECT d.id, d.stage_id, d.title, d.value_cents, d.status, d.person_id, d.organization_id, p.name AS person_name, o.name AS organization_name,
       d.owner_id, u.name AS owner_name, d.sla_at, d.due_at, d.position, d.stage_entered_at, d.created_at, d.updated_at, d.closed_at,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL) AS tasks_total,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 1) AS tasks_done,
       (SELECT MIN(a.due_at) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0) AS next_task_due_at,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 AND ${OVERDUE_COND}) AS act_overdue,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 AND NOT ${OVERDUE_COND}
          AND ((a.due_at >= ? AND a.due_at < ?) OR (a.end_at IS NOT NULL AND a.end_at >= ? AND a.end_at < ?))) AS act_today,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0) AS act_pending,
       (SELECT COUNT(*) FROM note n WHERE n.entity_type = 'deal' AND n.entity_id = d.id AND n.deleted_at IS NULL) AS notes_count,
       (SELECT COUNT(*) FROM deal_participant dp JOIN person pp ON pp.id = dp.person_id AND pp.deleted_at IS NULL
          WHERE dp.deal_id = d.id AND dp.deleted_at IS NULL) AS extra_contacts,
       d.archived_at
     FROM deal d
     LEFT JOIN person p ON p.id = d.person_id
     LEFT JOIN organization o ON o.id = d.organization_id
     LEFT JOIN app_user u ON u.id = d.owner_id
     WHERE ${where.join(" AND ")}${scope.sql}
     ORDER BY ${SORT_SQL[opts.sort ?? "recent"]}, d.position`,
    ...overdueParams(now),
    ...overdueParams(now),
    today0,
    today1,
    today0,
    today1,
    ...params,
    ...scope.params,
  );
  const stages = many<{ id: string; name: string; color: string | null }>(
    db,
    "SELECT id, name, color FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position",
    pipelineId,
  );
  const keys = opts.fieldKeys ? [...new Set(opts.fieldKeys.filter(isCardFieldKey))].slice(0, 40) : undefined;
  const { values } = cardFieldValues(db, pipelineId, cards.map((c) => c.id), { keys });
  for (const c of cards) c.fields = values.get(c.id) ?? {};
  // Campos marcados para aparecer junto com o nome (título do cartão, contato, organização).
  const kind = one<{ type: PipelineType }>(db, "SELECT type FROM pipeline WHERE id = ?", pipelineId)?.type;
  const titleEx = kind ? nameExtras(db, KIND_BY_PIPELINE_TYPE[kind] as CustomFieldEntity, cards.map((c) => c.id)) : new Map<string, string>();
  const personEx = nameExtras(db, "person", cards.map((c) => c.person_id));
  const orgEx = nameExtras(db, "organization", cards.map((c) => c.organization_id));
  for (const c of cards) {
    c.title_ext = titleEx.get(c.id) ?? null;
    if (c.person_name) c.person_name = withExtra(c.person_name, personEx.get(c.person_id ?? ""));
    if (c.organization_name) c.organization_name = withExtra(c.organization_name, orgEx.get(c.organization_id ?? ""));
  }
  return stages.map((s) => {
    const inStage = cards.filter((c) => c.stage_id === s.id).map(({ stage_id: _s, ...c }) => c);
    return {
      ...s,
      count: inStage.length,
      total_cents: inStage.reduce((acc, c) => acc + c.value_cents, 0),
      overdue_activities: inStage.reduce((acc, c) => acc + c.act_overdue, 0),
      cards: inStage,
    };
  });
}

// ---------- Motivos de perda ----------

export function listLossReasons(db: DatabaseSync, opts: { includeInactive?: boolean } = {}): { id: string; name: string; active: number }[] {
  return many(
    db,
    `SELECT id, name, active FROM loss_reason WHERE deleted_at IS NULL ${opts.includeInactive ? "" : "AND active = 1"} ORDER BY name COLLATE NOCASE`,
  );
}

export function createLossReason(db: DatabaseSync, ctx: DbContext, name: string): string {
  return insertRow(db, ctx, "loss_reason", { name: requireText(name, "Informe o motivo.") });
}

export function updateLossReason(db: DatabaseSync, ctx: DbContext, id: string, patch: { name?: string; active?: boolean }): void {
  const data: Record<string, SqlValue> = {};
  if (patch.name !== undefined) data.name = requireText(patch.name, "Informe o motivo.");
  if (patch.active !== undefined) data.active = patch.active ? 1 : 0;
  updateRow(db, ctx, "loss_reason", id, data);
}

/** Negócios/tickets/etapas ligados a um contato ou organização (ficha), respeitando a permissão. */
export function listCardsForEntity(
  db: DatabaseSync,
  f: { personId?: string; organizationId?: string },
  viewer?: Viewer | null,
): { id: string; title: string; kind: DealKind; status: DealStatus; value_cents: number; pipeline_id: string; pipeline_name: string; stage_name: string; updated_at: string }[] {
  // Contato: principal ou um dos outros contatos do cartão.
  const col = f.personId
    ? "(d.person_id = ?1 OR EXISTS (SELECT 1 FROM deal_participant dp WHERE dp.deal_id = d.id AND dp.person_id = ?1 AND dp.deleted_at IS NULL))"
    : "d.organization_id = ?1";
  const id = f.personId ?? f.organizationId;
  if (!id) return [];
  const scope = cardScope(db, viewer);
  return many(
    db,
    `SELECT d.id, d.title, d.kind, d.status, d.value_cents, d.pipeline_id, p.name AS pipeline_name, s.name AS stage_name, d.updated_at
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id JOIN stage s ON s.id = d.stage_id
     WHERE ${col} AND d.deleted_at IS NULL${scope.sql}
     ORDER BY d.status = 'open' DESC, d.updated_at DESC`,
    id,
    ...scope.params,
  );
}

/** Busca de cartões para "Vinculado a" das tarefas (respeita a permissão). */
export function searchCards(db: DatabaseSync, text: string, viewer?: Viewer | null, limit = 10): { id: string; title: string; kind: DealKind; pipeline_name: string; person_name: string | null }[] {
  const scope = cardScope(db, viewer);
  const q = `%${text.trim()}%`;
  return many(
    db,
    `SELECT d.id, d.title, d.kind, p.name AS pipeline_name, pe.name AS person_name
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id LEFT JOIN person pe ON pe.id = d.person_id
     WHERE d.deleted_at IS NULL AND (d.title LIKE ? OR pe.name LIKE ?)${scope.sql}
     ORDER BY d.status = 'open' DESC, d.updated_at DESC LIMIT ?`,
    q,
    q,
    ...scope.params,
    limit,
  );
}
