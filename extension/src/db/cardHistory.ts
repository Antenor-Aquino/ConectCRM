// Histórico completo do cartão: junta o change_log do próprio cartão com o de
// tudo que pertence a ele (produtos, tags, campos personalizados, notas,
// anexos e tarefas) e descreve cada alteração em português, com o valor
// antigo e o novo. Gravações do mesmo usuário em até 2 segundos viram um só
// evento (ex.: salvar produtos também atualiza o valor do negócio).
import { OUTCOME_TEXT, PIPELINE_TYPE_BY_KIND } from "../lib/cardTypes";
import { formatCents, formatDateTime } from "../lib/format";
import type { DealKind } from "./pipelines";
import { many, type DatabaseSync } from "./sql";
import { RECURRENCE_LABEL, type Recurrence } from "./products";

/** Origem clicável de uma linha do histórico (nota, tarefa ou documento que ainda existe). */
export interface HistoryRef {
  kind: "note" | "activity" | "document";
  id: string;
}

export interface HistoryEvent {
  at: string;
  userId: string | null;
  userName: string;
  lines: string[];
  /** Mesma posição de `lines`: a origem da linha (null = só texto). */
  refs: (HistoryRef | null)[];
}

interface LogRow {
  table_name: string;
  row_id: string;
  op: "insert" | "update" | "delete" | "restore";
  changes: string;
  user_id: string | null;
  at: string;
  row_version: number;
}

type Changes = Record<string, [unknown, unknown]>;

const DEAL_FIELDS: Record<string, string> = {
  title: "Título",
  description: "Descrição",
  value_cents: "Valor",
  sla_at: "SLA",
  start_at: "Início",
  due_at: "Prazo",
  expected_close_at: "Previsão de fechamento",
  person_id: "Contato",
  organization_id: "Organização",
  owner_id: "Responsável",
  loss_reason_id: "Motivo da perda",
  loss_note: "Observação da perda",
  origin: "Origem",
  pipeline_id: "Funil",
};
/** Campos internos que não interessam ao usuário. */
const DEAL_SKIP = new Set(["position", "stage_entered_at", "value_from_items", "closed_at", "currency", "kind"]);
const ITEM_FIELDS: Record<string, string> = {
  description: "Descrição",
  quantity: "Quantidade",
  unit_price_cents: "Preço unit.",
  discount_cents: "Desconto",
  total_cents: "Total",
  recurrence: "Recorrência",
  product_id: "Produto",
};

const WINDOW_MS = 2000;

const clip = (s: unknown, n = 120) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const qty = (n: unknown) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Nomes por id (inclui excluídos: o histórico precisa do nome antigo). */
function lookup(db: DatabaseSync, table: string, col = "name"): Map<string, string> {
  return new Map(many<{ id: string; v: string }>(db, `SELECT id, ${col} AS v FROM ${table}`).map((r) => [r.id, r.v]));
}

/** Valor de campo personalizado como texto (mesmas regras de exibição do CRM). */
export function formatCustomRaw(
  raw: string | null | undefined,
  type: string,
  names: { options: Map<string, string>; users: Map<string, string>; persons: Map<string, string>; orgs: Map<string, string>; documents?: Map<string, string> },
): string {
  if (raw == null || raw === "") return "vazio";
  switch (type) {
    case "money":
      return formatCents(Number(raw));
    case "number":
      return Number(raw).toLocaleString("pt-BR");
    case "boolean":
      return raw === "1" ? "Sim" : "Não";
    case "date": {
      const [y, m, d] = raw.split("-");
      return `${d}/${m}/${y}`;
    }
    case "datetime":
      return formatDateTime(raw);
    case "select":
      return names.options.get(raw) ?? raw;
    case "multiselect":
      try {
        return (JSON.parse(raw) as string[]).map((id) => names.options.get(id) ?? id).join(", ") || "vazio";
      } catch {
        return raw;
      }
    case "user":
      return names.users.get(raw) ?? raw;
    case "person":
      return names.persons.get(raw) ?? raw;
    case "organization":
      return names.orgs.get(raw) ?? raw;
    case "document":
      return names.documents?.get(raw) ?? "documento";
    default:
      return clip(raw, 80);
  }
}

export function cardHistory(db: DatabaseSync, cardId: string): HistoryEvent[] {
  // Termos do desfecho conforme o tipo do funil (ganho, resolvido, concluído...).
  const kind = many<{ kind: DealKind }>(db, "SELECT kind FROM deal WHERE id = ?", cardId)[0]?.kind ?? "deal";
  const outcome = OUTCOME_TEXT[PIPELINE_TYPE_BY_KIND[kind]];
  const dealFields = { ...DEAL_FIELDS, loss_reason_id: outcome.lossReason, loss_note: outcome.lossNote };
  const statusName: Record<string, string> = { open: "aberto", won: outcome.won.toLowerCase(), lost: outcome.lost.toLowerCase() };
  const users = lookup(db, "app_user");
  const stages = lookup(db, "stage");
  const persons = lookup(db, "person");
  const orgs = lookup(db, "organization");
  const reasons = lookup(db, "loss_reason");
  const pipelines = lookup(db, "pipeline");
  const tags = lookup(db, "tag");
  const products = lookup(db, "product");
  const documents = lookup(db, "document");
  const options = lookup(db, "custom_field_option", "label");
  const fields = new Map(many<{ id: string; name: string; field_type: string }>(db, "SELECT id, name, field_type FROM custom_field").map((f) => [f.id, f]));

  // Registros que pertencem ao cartão (inclusive os já excluídos).
  const owned: { table: string; sql: string }[] = [
    { table: "deal_item", sql: "SELECT id FROM deal_item WHERE deal_id = ?" },
    { table: "entity_tag", sql: "SELECT id FROM entity_tag WHERE entity_id = ?" },
    { table: "custom_field_value", sql: "SELECT id FROM custom_field_value WHERE entity_id = ?" },
    { table: "note", sql: "SELECT id FROM note WHERE entity_type = 'deal' AND entity_id = ?" },
    { table: "attachment", sql: "SELECT id FROM attachment WHERE entity_type = 'deal' AND entity_id = ?" },
    { table: "document_link", sql: "SELECT id FROM document_link WHERE entity_type = 'deal' AND entity_id = ?" },
    { table: "activity", sql: "SELECT id FROM activity WHERE deal_id = ?" },
  ];
  const ids: string[] = [cardId];
  for (const o of owned) ids.push(...many<{ id: string }>(db, o.sql, cardId).map((r) => r.id));
  const logs = many<LogRow>(
    db,
    `SELECT table_name, row_id, op, changes, user_id, at, row_version FROM change_log
     WHERE row_id IN (${ids.map(() => "?").join(", ")}) ORDER BY at, rowid`,
    ...ids,
  );

  // Estado atual de cada linha, montado a partir do log (para nomear excluídos).
  const state = new Map<string, Record<string, unknown>>();
  const name = (map: Map<string, string>, id: unknown) => (id ? (map.get(String(id)) ?? "removido") : "vazio");

  const fmtDeal = (field: string, v: unknown): string => {
    if (v == null || v === "") return "vazio";
    if (field === "value_cents") return formatCents(Number(v));
    if (field.endsWith("_at")) return formatDateTime(String(v));
    if (field === "person_id") return name(persons, v);
    if (field === "organization_id") return name(orgs, v);
    if (field === "owner_id") return name(users, v);
    if (field === "loss_reason_id") return name(reasons, v);
    if (field === "pipeline_id") return name(pipelines, v);
    return clip(v, 80);
  };
  const fmtItem = (field: string, v: unknown): string => {
    if (v == null || v === "") return "vazio";
    if (field.endsWith("_cents")) return formatCents(Number(v));
    if (field === "quantity") return qty(v);
    if (field === "product_id") return name(products, v);
    if (field === "recurrence") return RECURRENCE_LABEL[v as Recurrence] ?? String(v);
    return clip(v, 80);
  };
  const itemSummary = (r: Record<string, unknown>) =>
    `${r.description} — ${qty(r.quantity)} × ${formatCents(Number(r.unit_price_cents))}${Number(r.discount_cents) ? ` − desc. ${formatCents(Number(r.discount_cents))}` : ""} = ${formatCents(Number(r.total_cents))}`;
  const fieldChanges = (ch: Changes, labels: Record<string, string>, fmt: (f: string, v: unknown) => string, skip = new Set<string>()) =>
    Object.entries(ch)
      .filter(([f]) => labels[f] && !skip.has(f))
      .map(([f, [a, b]]) => `${labels[f]}: ${fmt(f, a)} → ${fmt(f, b)}`);

  function describe(l: LogRow): string[] {
    const ch = JSON.parse(l.changes) as Changes;
    const prev = state.get(l.row_id) ?? {};
    const next = { ...prev, ...Object.fromEntries(Object.entries(ch).map(([k, [, b]]) => [k, b])) };
    state.set(l.row_id, next);
    const t = l.table_name;
    if (t === "deal") {
      if (l.op === "insert") return [`Criou o cartão "${next.title}" na etapa ${name(stages, next.stage_id)}`];
      if (l.op === "delete") return ["Excluiu o cartão"];
      if (l.op === "restore") return ["Restaurou o cartão"];
      const out: string[] = [];
      if (ch.pipeline_id) {
        // Mudou de funil: funil › etapa antes e depois numa linha só.
        const [pa, pb] = ch.pipeline_id as [string, string];
        const [sa, sb] = (ch.stage_id as [string, string] | undefined) ?? [prev.stage_id as string, next.stage_id as string];
        out.push(`Mudou de funil: ${name(pipelines, pa)} › ${name(stages, sa)} → ${name(pipelines, pb)} › ${name(stages, sb)}`);
      } else if (ch.stage_id) out.push(`Moveu de etapa: ${name(stages, ch.stage_id[0])} → ${name(stages, ch.stage_id[1])}`);
      if (ch.status) {
        const [a, b] = ch.status as [string, string];
        out.push(b === "won" ? outcome.markedWon : b === "lost" ? outcome.markedLost : `Reabriu (estava ${statusName[a] ?? a})`);
      }
      out.push(...fieldChanges(ch, dealFields, fmtDeal, ch.pipeline_id ? new Set([...DEAL_SKIP, "pipeline_id"]) : DEAL_SKIP));
      return out;
    }
    if (t === "deal_item") {
      if (l.op === "insert") return [`Adicionou produto: ${itemSummary(next)}`];
      if (l.op === "delete") return [`Removeu produto: ${next.description ?? "item"}`];
      if (l.op === "restore") return [`Restaurou produto: ${next.description ?? "item"}`];
      const changes = fieldChanges(ch, ITEM_FIELDS, fmtItem, new Set(["total_cents"]));
      return changes.length ? [`Alterou produto ${next.description}: ${changes.join("; ")}`] : [];
    }
    if (t === "entity_tag") {
      const tag = name(tags, next.tag_id);
      if (l.op === "insert" || l.op === "restore") return [`Adicionou a tag ${tag}`];
      if (l.op === "delete") return [`Removeu a tag ${tag}`];
      return [];
    }
    if (t === "custom_field_value") {
      const f = fields.get(String(next.field_id));
      if (!f) return [];
      const fmt = (v: unknown) => formatCustomRaw(v == null ? null : String(v), f.field_type, { options, users, persons, orgs, documents });
      if (l.op === "insert") return [`Campo "${f.name}": ${fmt(next.value)}`];
      if (l.op === "delete") return [`Campo "${f.name}" apagado (era ${fmt(prev.value)})`];
      if (ch.value) return [`Campo "${f.name}": ${fmt(ch.value[0])} → ${fmt(ch.value[1])}`];
      return [];
    }
    if (t === "note") {
      if (l.op === "insert") return [`Adicionou nota: "${clip(next.body)}"`];
      if (l.op === "delete") return [`Excluiu nota: "${clip(next.body, 60)}"`];
      if (ch.pinned) return [ch.pinned[1] ? "Fixou uma nota" : "Desafixou uma nota"];
      if (ch.body) return [`Editou nota: "${clip(ch.body[0], 60)}" → "${clip(ch.body[1], 60)}"`];
      return [];
    }
    if (t === "attachment") {
      if (l.op === "insert") return [`Anexou o arquivo ${next.filename}`];
      if (l.op === "delete") return [`Removeu o anexo ${next.filename}`];
      return [];
    }
    if (t === "document_link") {
      if (l.op === "insert") return [`Vinculou o documento ${name(documents, next.document_id)}`];
      if (l.op === "delete") return [`Desvinculou o documento ${name(documents, next.document_id)}`];
      return [];
    }
    if (t === "activity") {
      const title = `"${next.title}"`;
      if (l.op === "insert") return [`Criou a atividade ${title} com início em ${formatDateTime(String(next.due_at))}${next.end_at ? ` e finalização em ${formatDateTime(String(next.end_at))}` : ""}`];
      if (l.op === "delete") return [`Excluiu a atividade ${title}`];
      const out: string[] = [];
      if (ch.done) out.push(ch.done[1] ? `Concluiu a atividade ${title}` : `Reabriu a atividade ${title}`);
      if (ch.due_at) out.push(`Remarcou o início da atividade ${title}: ${formatDateTime(String(ch.due_at[0]))} → ${formatDateTime(String(ch.due_at[1]))}`);
      if (ch.end_at) {
        const f = (v: unknown) => (v ? formatDateTime(String(v)) : "sem finalização");
        out.push(`Finalização da atividade ${title}: ${f(ch.end_at[0])} → ${f(ch.end_at[1])}`);
      }
      if (ch.title) out.push(`Renomeou a atividade: "${ch.title[0]}" → "${ch.title[1]}"`);
      if (ch.owner_id) out.push(`Atividade ${title}: responsável ${name(users, ch.owner_id[0])} → ${name(users, ch.owner_id[1])}`);
      if (ch.deal_id && ch.deal_id[1] === cardId && ch.deal_id[0] !== cardId) out.push(`Vinculou a atividade ${title} a este cartão`);
      if (ch.deal_id && ch.deal_id[0] === cardId) out.push(`Desvinculou a atividade ${title} deste cartão`);
      return out;
    }
    return [];
  }

  // O que ainda existe pode ser aberto a partir do histórico.
  const alive = (table: string) => new Set(many<{ id: string }>(db, `SELECT id FROM ${table} WHERE deleted_at IS NULL`).map((r) => r.id));
  const liveNotes = alive("note");
  const liveTasks = alive("activity");
  const liveDocs = new Set(many<{ id: string }>(db, "SELECT id FROM document WHERE deleted_at IS NULL AND purged_at IS NULL").map((r) => r.id));
  const refOf = (l: LogRow): HistoryRef | null => {
    if (l.table_name === "note" && liveNotes.has(l.row_id)) return { kind: "note", id: l.row_id };
    if (l.table_name === "activity" && liveTasks.has(l.row_id)) return { kind: "activity", id: l.row_id };
    const docId = l.table_name === "document_link" ? String(state.get(l.row_id)?.document_id ?? "") : "";
    if (docId && liveDocs.has(docId)) return { kind: "document", id: docId };
    return null;
  };

  const events: HistoryEvent[] = [];
  for (const l of logs) {
    const lines = describe(l);
    if (!lines.length) continue;
    const ref = refOf(l);
    const refs = lines.map(() => ref);
    const last = events.at(-1);
    if (last && last.userId === l.user_id && new Date(l.at).getTime() - new Date(last.at).getTime() <= WINDOW_MS) {
      last.lines.push(...lines);
      last.refs.push(...refs);
    } else {
      events.push({ at: l.at, userId: l.user_id, userName: l.user_id ? (users.get(l.user_id) ?? "Usuário removido") : "Sistema", lines, refs });
    }
  }
  return events.reverse();
}
