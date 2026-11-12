// Mesclar registros duplicados (spec 17; substitui a mesclagem simples de db/merge.ts): negócios/tickets/etapas de projeto,
// contatos e organizações. Um registro fica (o "principal"), o outro some;
// para cada campo escolhe-se o valor de um dos dois, e TUDO o que estava
// ligado ao que sai (atividades, notas, documentos, etiquetas, cartões,
// contatos, organizações, produtos, histórico, tarefas do To Do, vínculos de
// importação…) passa para o que fica. A mesclagem não se desfaz: o registro
// que sai não vai para a lixeira (voltaria vazio); fica uma nota no principal.
//
// Gestão Financeira: os lançamentos de lá apontam para o cartão e para o
// contato/organização pelo id. Por isso o registro ligado ao financeiro é
// sempre o que fica; se os dois estiverem ligados, a mesclagem é recusada.
import { formatCents } from "../lib/format";
import { ValidationError } from "../lib/validate";
import { cardFinanceLock, hasFinance } from "./financeLock";
import { markContactChanged } from "./finance";
import { getRow, insertRow, softDelete, updateRow, type DataTable, type DbContext } from "./repo";
import { many, one, run, withTransaction, type DatabaseSync, type SqlValue } from "./sql";

export type MergeEntity = "deal" | "person" | "organization";

interface FieldGroup {
  key: string;
  label: string;
  cols: string[];
  /** Só para cartões desses tipos. */
  kinds?: string[];
}

const GROUPS: Record<MergeEntity, FieldGroup[]> = {
  person: [
    { key: "name", label: "Nome", cols: ["name"] },
    { key: "email", label: "E-mail", cols: ["email"] },
    { key: "phone", label: "Telefone", cols: ["phone", "phone_country"] },
    { key: "cpf", label: "CPF", cols: ["cpf"] },
    { key: "owner", label: "Responsável", cols: ["owner_id"] },
    { key: "avatar", label: "Foto", cols: ["avatar_id"] },
    { key: "notes", label: "Observações", cols: ["notes"] },
  ],
  organization: [
    { key: "name", label: "Nome fantasia", cols: ["name"] },
    { key: "legal_name", label: "Razão social", cols: ["legal_name"] },
    { key: "cnpj", label: "CNPJ", cols: ["cnpj", "cnpj_data"] },
    { key: "email", label: "E-mail", cols: ["email"] },
    { key: "phone", label: "Telefone", cols: ["phone", "phone_country"] },
    { key: "website", label: "Site", cols: ["website"] },
    { key: "segment", label: "Segmento", cols: ["segment"] },
    { key: "address", label: "Endereço", cols: ["cep", "street", "number", "complement", "district", "city", "state", "country"] },
    { key: "owner", label: "Responsável", cols: ["owner_id"] },
    { key: "logo", label: "Logo", cols: ["logo_id"] },
    { key: "description", label: "Descrição", cols: ["description"] },
  ],
  deal: [
    { key: "title", label: "Título", cols: ["title"] },
    { key: "value", label: "Valor", cols: ["value_cents", "currency", "value_from_items"] },
    { key: "stage", label: "Funil e etapa", cols: ["pipeline_id", "stage_id", "stage_entered_at"] },
    { key: "status", label: "Situação", cols: ["status", "loss_reason_id", "loss_note", "closed_at"] },
    { key: "person", label: "Contato principal", cols: ["person_id"] },
    { key: "organization", label: "Organização", cols: ["organization_id"] },
    { key: "owner", label: "Responsável", cols: ["owner_id"] },
    { key: "expected_close_at", label: "Previsão de fechamento", cols: ["expected_close_at"], kinds: ["deal"] },
    { key: "sla_at", label: "Prazo (SLA)", cols: ["sla_at"], kinds: ["ticket"] },
    { key: "start_at", label: "Início", cols: ["start_at"], kinds: ["project"] },
    { key: "due_at", label: "Entrega", cols: ["due_at"], kinds: ["project"] },
    { key: "origin", label: "Origem", cols: ["origin"] },
    { key: "description", label: "Descrição", cols: ["description"] },
  ],
};

const NOUN: Record<MergeEntity, string> = { deal: "cartão", person: "contato", organization: "organização" };

type Row = Record<string, SqlValue>;

function rowOf(db: DatabaseSync, entity: MergeEntity, id: string): Row {
  const r = getRow(db, entity, id) as Row | undefined;
  if (!r) throw new ValidationError(`${NOUN[entity][0]!.toUpperCase()}${NOUN[entity].slice(1)} não encontrad${entity === "organization" ? "a" : "o"}.`);
  return r;
}

const name = (db: DatabaseSync, table: string, col: string, id: SqlValue | undefined): string | null =>
  id ? (one<{ n: string }>(db, `SELECT ${col} AS n FROM ${table} WHERE id = ?`, id)?.n ?? null) : null;

const dmy = (v: SqlValue | undefined) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : null);

/** Texto do grupo para a tela de comparação (vazio = null). */
function display(db: DatabaseSync, entity: MergeEntity, g: FieldGroup, r: Row): string | null {
  const v = (c: string) => r[c];
  switch (g.key) {
    case "owner":
      return name(db, "app_user", "name", v("owner_id"));
    case "avatar":
    case "logo":
      return v(g.cols[0]!) ? "Tem imagem" : null;
    case "value":
      return v("value_from_items") ? `${formatCents(Number(v("value_cents")))} (soma dos produtos)` : Number(v("value_cents")) ? formatCents(Number(v("value_cents"))) : null;
    case "stage":
      return `${name(db, "pipeline", "name", v("pipeline_id")) ?? "?"} › ${name(db, "stage", "name", v("stage_id")) ?? "?"}`;
    case "status": {
      const s = v("status");
      if (s === "won") return `Ganho${dmy(v("closed_at")) ? ` em ${dmy(v("closed_at"))}` : ""}`;
      if (s === "lost") return `Perdido${name(db, "loss_reason", "name", v("loss_reason_id")) ? ` (${name(db, "loss_reason", "name", v("loss_reason_id"))})` : ""}`;
      return "Aberto";
    }
    case "person":
      return name(db, "person", "name", v("person_id"));
    case "organization":
      return name(db, "organization", "name", v("organization_id"));
    case "address": {
      const parts = [[v("street"), v("number")].filter(Boolean).join(", "), v("complement"), v("district"), [v("city"), v("state")].filter(Boolean).join("/"), v("cep")]
        .map((x) => (x ? String(x) : ""))
        .filter(Boolean);
      return parts.length ? parts.join(" · ") : null;
    }
    case "expected_close_at":
    case "sla_at":
    case "start_at":
    case "due_at":
      return dmy(v(g.cols[0]!));
    default: {
      const x = v(g.cols[0]!);
      return x === null || x === undefined || x === "" ? null : String(x);
    }
  }
}

function customDisplay(db: DatabaseSync, fieldType: string, raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  if (fieldType === "select" || fieldType === "multiselect") {
    let ids: string[];
    try {
      const p = JSON.parse(raw) as unknown;
      ids = Array.isArray(p) ? p.map(String) : [String(p)];
    } catch {
      ids = [raw];
    }
    return ids.map((id) => name(db, "custom_field_option", "label", id) ?? id).join(", ");
  }
  if (fieldType === "boolean") return raw === "1" || raw === "true" ? "Sim" : "Não";
  if (fieldType === "date") return dmy(raw) ?? raw;
  return raw;
}

// ---------- Vínculo com a Gestão Financeira ----------

function financeLinked(db: DatabaseSync, entity: MergeEntity, id: string): boolean {
  if (entity === "deal") return hasFinance(cardFinanceLock(db, id));
  return !!one(db, "SELECT 1 FROM finance_contact WHERE crm_ref = ?", `${entity}:${id}`);
}

// ---------- Prévia ----------

export interface MergeSide {
  id: string;
  label: string;
  createdAt: string;
  /** Ligado à Gestão Financeira (só ele pode ficar). */
  finance: boolean;
  /** Quantos registros ligados ele leva. */
  related: { label: string; n: number; text: string }[];
}

export interface MergePreview {
  entity: MergeEntity;
  a: MergeSide;
  b: MergeSide;
  /** Quem deve ficar: o ligado ao financeiro; senão o mais antigo. null = ambos ligados (não mescla). */
  suggestedKeep: string | null;
  blocked: string | null;
  groups: { key: string; label: string; a: string | null; b: string | null }[];
  custom: { fieldId: string; label: string; a: string | null; b: string | null }[];
}

const SINGULAR: Record<string, string> = {
  Atividades: "Atividade",
  Notas: "Nota",
  Documentos: "Documento",
  Produtos: "Produto",
  "Outros contatos": "Outro contato",
  "Tarefas do To Do": "Tarefa do To Do",
  Cartões: "Cartão",
  Organizações: "Organização",
  Contatos: "Contato",
  Etiquetas: "Etiqueta",
};

const count = (db: DatabaseSync, sql: string, ...p: SqlValue[]) => one<{ n: number }>(db, sql, ...p)?.n ?? 0;

function related(db: DatabaseSync, entity: MergeEntity, id: string): { label: string; n: number; text: string }[] {
  const live = "deleted_at IS NULL";
  const out: [string, number][] =
    entity === "deal"
      ? [
          ["Atividades", count(db, `SELECT COUNT(*) AS n FROM activity WHERE deal_id = ? AND ${live}`, id)],
          ["Notas", count(db, `SELECT COUNT(*) AS n FROM note WHERE entity_type = 'deal' AND entity_id = ? AND ${live}`, id)],
          ["Documentos", count(db, `SELECT COUNT(*) AS n FROM document_link WHERE entity_type = 'deal' AND entity_id = ? AND ${live}`, id)],
          ["Produtos", count(db, `SELECT COUNT(*) AS n FROM deal_item WHERE deal_id = ? AND ${live}`, id)],
          ["Outros contatos", count(db, `SELECT COUNT(*) AS n FROM deal_participant WHERE deal_id = ? AND person_id IS NOT NULL AND ${live}`, id)],
          ["Tarefas do To Do", count(db, `SELECT COUNT(*) AS n FROM todo_task WHERE deal_id = ? AND ${live}`, id)],
        ]
      : entity === "person"
        ? [
            ["Cartões", count(db, `SELECT COUNT(*) AS n FROM deal WHERE (person_id = ? OR id IN (SELECT deal_id FROM deal_participant WHERE person_id = ? AND ${live})) AND ${live}`, id, id)],
            ["Organizações", count(db, `SELECT COUNT(*) AS n FROM person_organization WHERE person_id = ? AND ${live}`, id)],
            ["Atividades", count(db, `SELECT COUNT(*) AS n FROM activity WHERE person_id = ? AND ${live}`, id)],
            ["Notas", count(db, `SELECT COUNT(*) AS n FROM note WHERE entity_type = 'person' AND entity_id = ? AND ${live}`, id)],
            ["Documentos", count(db, `SELECT COUNT(*) AS n FROM document_link WHERE entity_type = 'person' AND entity_id = ? AND ${live}`, id)],
          ]
        : [
            ["Contatos", count(db, `SELECT COUNT(*) AS n FROM person_organization WHERE organization_id = ? AND ${live}`, id)],
            ["Cartões", count(db, `SELECT COUNT(*) AS n FROM deal WHERE organization_id = ? AND ${live}`, id)],
            ["Atividades", count(db, `SELECT COUNT(*) AS n FROM activity WHERE organization_id = ? AND ${live}`, id)],
            ["Notas", count(db, `SELECT COUNT(*) AS n FROM note WHERE entity_type = 'organization' AND entity_id = ? AND ${live}`, id)],
            ["Documentos", count(db, `SELECT COUNT(*) AS n FROM document_link WHERE entity_type = 'organization' AND entity_id = ? AND ${live}`, id)],
          ];
  out.push(["Etiquetas", count(db, `SELECT COUNT(*) AS n FROM entity_tag WHERE entity_id = ? AND ${live}`, id)]);
  return out.filter(([, n]) => n > 0).map(([label, n]) => ({ label, n, text: `${n} ${(n === 1 ? (SINGULAR[label] ?? label) : label).toLowerCase().replace("to do", "To Do")}` }));
}

function groupsFor(entity: MergeEntity, a: Row, b: Row): FieldGroup[] {
  return GROUPS[entity].filter((g) => !g.kinds || g.kinds.includes(String(a.kind)) || g.kinds.includes(String(b.kind)));
}

function customRows(db: DatabaseSync, id: string): Map<string, { label: string; type: string; value: string | null; rowId: string }> {
  return new Map(
    many<{ field_id: string; label: string; type: string; value: string | null; row_id: string }>(
      db,
      `SELECT v.field_id, f.name AS label, f.field_type AS type, v.value, v.id AS row_id FROM custom_field_value v
       JOIN custom_field f ON f.id = v.field_id AND f.deleted_at IS NULL WHERE v.entity_id = ? AND v.deleted_at IS NULL ORDER BY f.position`,
      id,
    ).map((r) => [r.field_id, { label: r.label, type: r.type, value: r.value, rowId: r.row_id }]),
  );
}

function checkPair(db: DatabaseSync, entity: MergeEntity, aId: string, bId: string): { a: Row; b: Row } {
  if (aId === bId) throw new ValidationError(`Escolha dois ${entity === "organization" ? "registros diferentes" : `${NOUN[entity]}s diferentes`} para mesclar.`);
  const a = rowOf(db, entity, aId);
  const b = rowOf(db, entity, bId);
  if (entity === "deal" && a.kind !== b.kind)
    throw new ValidationError("Só dá para mesclar cartões do mesmo tipo (negócio com negócio, ticket com ticket, etapa de projeto com etapa de projeto).");
  return { a, b };
}

const labelOf = (entity: MergeEntity, r: Row) => String(entity === "deal" ? r.title : r.name);

export function mergePreview(db: DatabaseSync, entity: MergeEntity, aId: string, bId: string): MergePreview {
  const { a, b } = checkPair(db, entity, aId, bId);
  const side = (r: Row): MergeSide => ({
    id: String(r.id),
    label: labelOf(entity, r),
    createdAt: String(r.created_at),
    finance: financeLinked(db, entity, String(r.id)),
    related: related(db, entity, String(r.id)),
  });
  const sa = side(a);
  const sb = side(b);
  const blocked =
    sa.finance && sb.finance
      ? `Os dois ${entity === "organization" ? "registros" : `${NOUN[entity]}s`} estão ligados à Gestão Financeira: mesclar deixaria lançamentos de lá sem referência. Ajuste na Gestão Financeira antes (um deles sem lançamentos/cadastro) ou mantenha os dois.`
      : null;
  const suggestedKeep = blocked ? null : sa.finance ? sa.id : sb.finance ? sb.id : sa.createdAt <= sb.createdAt ? sa.id : sb.id;
  const ca = customRows(db, sa.id);
  const cb = customRows(db, sb.id);
  const custom = [...new Set([...ca.keys(), ...cb.keys()])].map((fieldId) => {
    const x = ca.get(fieldId) ?? cb.get(fieldId)!;
    return { fieldId, label: x.label, a: customDisplay(db, x.type, ca.get(fieldId)?.value ?? null), b: customDisplay(db, x.type, cb.get(fieldId)?.value ?? null) };
  });
  return {
    entity,
    a: sa,
    b: sb,
    suggestedKeep,
    blocked,
    groups: groupsFor(entity, a, b)
      .map((g) => ({ key: g.key, label: g.label, a: display(db, entity, g, a), b: display(db, entity, g, b) }))
      .filter((g) => g.a !== null || g.b !== null),
    custom,
  };
}

// ---------- Mesclar ----------

export interface MergeInput {
  entity: MergeEntity;
  keepId: string;
  removeId: string;
  /** Grupos de campos (e campos personalizados, pelo id) cujo valor vem do registro que sai. */
  takeFromRemoved?: string[];
  /** Textos longos (observações, descrição) em que ficam os dois, um embaixo do outro. */
  joinBoth?: string[];
}

/** Textos que podem ficar "os dois juntos". */
export const JOINABLE = new Set(["notes", "description"]);

/**
 * Escolha padrão: o principal manda; campos vazios dele são completados com os
 * do que sai; observações/descrição dos dois ficam juntas.
 */
export function defaultChoices(db: DatabaseSync, entity: MergeEntity, keepId: string, removeId: string): { takeFromRemoved: string[]; joinBoth: string[] } {
  const p = mergePreview(db, entity, keepId, removeId);
  const keepSide = p.a.id === keepId ? "a" : "b";
  const other = keepSide === "a" ? "b" : "a";
  const take: string[] = [];
  const join: string[] = [];
  for (const g of p.groups) {
    if (g[keepSide] === null && g[other] !== null) take.push(g.key);
    else if (JOINABLE.has(g.key) && g[keepSide] !== null && g[other] !== null && g[keepSide] !== g[other]) join.push(g.key);
  }
  for (const c of p.custom) if (c[keepSide] === null && c[other] !== null) take.push(c.fieldId);
  return { takeFromRemoved: take, joinBoth: join };
}

/** Atualiza a coluna `col` de `from` para `to` nas linhas vivas (com histórico). */
function repoint(db: DatabaseSync, ctx: DbContext, table: DataTable, col: string, from: string, to: string, extraWhere = "", ...extra: SqlValue[]): void {
  for (const r of many<{ id: string }>(db, `SELECT id FROM ${table} WHERE ${col} = ? AND deleted_at IS NULL${extraWhere}`, from, ...extra))
    updateRow(db, ctx, table, r.id, { [col]: to });
}

/** Linhas polimórficas (entity_type/entity_id): move; o que já existir no principal sai (sem duplicar). */
function movePolymorphic(db: DatabaseSync, ctx: DbContext, entity: MergeEntity, from: string, to: string): void {
  repoint(db, ctx, "note", "entity_id", from, to, " AND entity_type = ?", entity);
  repoint(db, ctx, "attachment", "entity_id", from, to, " AND entity_type = ?", entity);
  for (const l of many<{ id: string; document_id: string }>(db, "SELECT id, document_id FROM document_link WHERE entity_type = ? AND entity_id = ? AND deleted_at IS NULL", entity, from)) {
    if (one(db, "SELECT 1 FROM document_link WHERE entity_type = ? AND entity_id = ? AND document_id = ? AND deleted_at IS NULL", entity, to, l.document_id)) softDelete(db, ctx, "document_link", l.id);
    else updateRow(db, ctx, "document_link", l.id, { entity_id: to });
  }
  for (const t of many<{ id: string; tag_id: string }>(db, "SELECT id, tag_id FROM entity_tag WHERE entity_id = ? AND deleted_at IS NULL", from)) {
    if (one(db, "SELECT 1 FROM entity_tag WHERE entity_id = ? AND tag_id = ? AND deleted_at IS NULL", to, t.tag_id)) softDelete(db, ctx, "entity_tag", t.id);
    else updateRow(db, ctx, "entity_tag", t.id, { entity_id: to });
  }
  repoint(db, ctx, "external_ref", "local_id", from, to, " AND entity_type = ?", entity);
  repoint(db, ctx, "record_origin", "local_id", from, to, " AND entity_type = ?", entity);
  repoint(db, ctx, "whatsapp_send", "context_id", from, to, " AND context_type = ?", entity);
  if (entity !== "deal") repoint(db, ctx, "whatsapp_send", "recipient_id", from, to, " AND recipient_kind = ?", entity);
}

function moveDeal(db: DatabaseSync, ctx: DbContext, from: string, to: string): void {
  const keep = rowOf(db, "deal", to);
  for (const p of many<{ id: string; person_id: string | null; user_id: string | null }>(db, "SELECT id, person_id, user_id FROM deal_participant WHERE deal_id = ? AND deleted_at IS NULL", from)) {
    const dup = p.person_id
      ? keep.person_id === p.person_id || one(db, "SELECT 1 FROM deal_participant WHERE deal_id = ? AND person_id = ? AND deleted_at IS NULL", to, p.person_id)
      : one(db, "SELECT 1 FROM deal_participant WHERE deal_id = ? AND user_id = ? AND deleted_at IS NULL", to, p.user_id);
    if (dup) softDelete(db, ctx, "deal_participant", p.id);
    else updateRow(db, ctx, "deal_participant", p.id, { deal_id: to });
  }
  // Contato principal do que sai vira "outro contato" do que fica (se for outra pessoa).
  const removed = rowOf(db, "deal", from);
  if (removed.person_id && removed.person_id !== keep.person_id && !one(db, "SELECT 1 FROM deal_participant WHERE deal_id = ? AND person_id = ? AND deleted_at IS NULL", to, removed.person_id))
    insertRow(db, ctx, "deal_participant", { deal_id: to, person_id: removed.person_id });
  const lastPos = one<{ p: number | null }>(db, "SELECT MAX(position) AS p FROM deal_item WHERE deal_id = ? AND deleted_at IS NULL", to)?.p ?? 0;
  many<{ id: string }>(db, "SELECT id FROM deal_item WHERE deal_id = ? AND deleted_at IS NULL ORDER BY position", from).forEach((it, i) =>
    updateRow(db, ctx, "deal_item", it.id, { deal_id: to, position: lastPos + i + 1 }),
  );
  repoint(db, ctx, "deal_stage_history", "deal_id", from, to);
  repoint(db, ctx, "activity", "deal_id", from, to);
  repoint(db, ctx, "todo_task", "deal_id", from, to);
  repoint(db, ctx, "whatsapp_capture", "deal_id", from, to);
  movePolymorphic(db, ctx, "deal", from, to);
  // Cópia local do financeiro (o que sai não tem lançamentos: regra acima).
  run(db, "DELETE FROM finance_sync WHERE deal_id = ?", from);
}

function movePerson(db: DatabaseSync, ctx: DbContext, from: string, to: string): void {
  const hasPrimary = !!one(db, "SELECT 1 FROM person_organization WHERE person_id = ? AND is_primary = 1 AND deleted_at IS NULL", to);
  for (const l of many<{ id: string; organization_id: string; is_primary: number }>(db, "SELECT id, organization_id, is_primary FROM person_organization WHERE person_id = ? AND deleted_at IS NULL", from)) {
    if (one(db, "SELECT 1 FROM person_organization WHERE person_id = ? AND organization_id = ? AND deleted_at IS NULL", to, l.organization_id)) softDelete(db, ctx, "person_organization", l.id);
    else updateRow(db, ctx, "person_organization", l.id, { person_id: to, is_primary: hasPrimary ? 0 : l.is_primary });
  }
  repoint(db, ctx, "deal", "person_id", from, to);
  for (const p of many<{ id: string; deal_id: string }>(db, "SELECT id, deal_id FROM deal_participant WHERE person_id = ? AND deleted_at IS NULL", from)) {
    const dup =
      one(db, "SELECT 1 FROM deal WHERE id = ? AND person_id = ?", p.deal_id, to) ||
      one(db, "SELECT 1 FROM deal_participant WHERE deal_id = ? AND person_id = ? AND deleted_at IS NULL", p.deal_id, to);
    if (dup) softDelete(db, ctx, "deal_participant", p.id);
    else updateRow(db, ctx, "deal_participant", p.id, { person_id: to });
  }
  // O que sai era principal num cartão em que o que fica era "outro contato": tira a repetição.
  for (const p of many<{ id: string }>(
    db,
    "SELECT dp.id FROM deal_participant dp JOIN deal d ON d.id = dp.deal_id WHERE dp.person_id = ? AND d.person_id = ? AND dp.deleted_at IS NULL",
    to,
    to,
  ))
    softDelete(db, ctx, "deal_participant", p.id);
  repoint(db, ctx, "activity", "person_id", from, to);
  repoint(db, ctx, "activity_contact_message", "person_id", from, to);
  repoint(db, ctx, "whatsapp_capture", "person_id", from, to);
  repoint(db, ctx, "todo_task", "person_id", from, to);
  movePolymorphic(db, ctx, "person", from, to);
}

function moveOrganization(db: DatabaseSync, ctx: DbContext, from: string, to: string): void {
  for (const l of many<{ id: string; person_id: string }>(db, "SELECT id, person_id FROM person_organization WHERE organization_id = ? AND deleted_at IS NULL", from)) {
    if (one(db, "SELECT 1 FROM person_organization WHERE person_id = ? AND organization_id = ? AND deleted_at IS NULL", l.person_id, to)) softDelete(db, ctx, "person_organization", l.id);
    else updateRow(db, ctx, "person_organization", l.id, { organization_id: to });
  }
  repoint(db, ctx, "deal", "organization_id", from, to);
  repoint(db, ctx, "activity", "organization_id", from, to);
  movePolymorphic(db, ctx, "organization", from, to);
}

/** Mescla: o que sai passa tudo para o que fica e deixa de existir. Devolve o id que ficou. */
export function mergeRecords(db: DatabaseSync, ctx: DbContext, input: MergeInput): string {
  const { entity, keepId, removeId } = input;
  const take = new Set(input.takeFromRemoved ?? []);
  const join = new Set((input.joinBoth ?? []).filter((k) => JOINABLE.has(k)));
  return withTransaction(db, () => {
    const { a: keep, b: removed } = checkPair(db, entity, keepId, removeId);
    if (financeLinked(db, entity, removeId)) {
      if (financeLinked(db, entity, keepId)) throw new ValidationError(mergePreview(db, entity, keepId, removeId).blocked!);
      throw new ValidationError(`O ${NOUN[entity]} “${labelOf(entity, removed)}” está ligado à Gestão Financeira: ele precisa ser o que fica.`);
    }
    // Valores escolhidos do que sai (gravados depois que ele sai, por causa de CPF/CNPJ únicos).
    const patch: Row = {};
    for (const g of groupsFor(entity, keep, removed)) {
      if (join.has(g.key)) {
        const col = g.cols[0]!;
        const both = [keep[col], removed[col]].filter((x) => x !== null && x !== undefined && String(x).trim() !== "");
        patch[col] = both.length ? both.join("\n\n") : null;
      } else if (take.has(g.key)) for (const c of g.cols) patch[c] = removed[c] ?? null;
    }
    if (patch.stage_id !== undefined && patch.stage_id !== keep.stage_id) patch.position = Date.now();
    const customKeep = customRows(db, keepId);
    const customRemoved = customRows(db, removeId);

    if (entity === "deal") moveDeal(db, ctx, removeId, keepId);
    else if (entity === "person") movePerson(db, ctx, removeId, keepId);
    else moveOrganization(db, ctx, removeId, keepId);

    // Campos personalizados: o valor do que sai vale quando escolhido ou quando o principal não tem.
    for (const [fieldId, r] of customRemoved) {
      const k = customKeep.get(fieldId);
      if (!k) updateRow(db, ctx, "custom_field_value", r.rowId, { entity_id: keepId });
      else {
        if (take.has(fieldId)) updateRow(db, ctx, "custom_field_value", k.rowId, { value: r.value });
        softDelete(db, ctx, "custom_field_value", r.rowId);
      }
    }

    softDelete(db, ctx, entity, removeId);
    if (Object.keys(patch).length) updateRow(db, ctx, entity, keepId, patch);
    // Valor pela soma dos produtos (os do que saiu vieram junto).
    if (entity === "deal") {
      const fromItems = (patch.value_from_items ?? keep.value_from_items) as number;
      if (fromItems) {
        const sum = one<{ s: number | null }>(db, "SELECT SUM(total_cents) AS s FROM deal_item WHERE deal_id = ? AND deleted_at IS NULL", keepId)?.s ?? 0;
        updateRow(db, ctx, "deal", keepId, { value_cents: sum, value_from_items: 1 });
      }
    }
    if (entity !== "deal") markContactChanged(db, entity, keepId);

    const who = ctx.userId ? (name(db, "app_user", "name", ctx.userId) ?? "") : "";
    insertRow(db, ctx, "note", {
      entity_type: entity,
      entity_id: keepId,
      body: `Mesclado com “${labelOf(entity, removed)}”${who ? ` por ${who}` : ""}. Atividades, notas, documentos e demais vínculos de “${labelOf(entity, removed)}” vieram para cá.`,
    });
    return keepId;
  });
}
