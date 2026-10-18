// Valores dos campos configurados para os cartões do quadro (lib/cardFields).
// Busca só o que a configuração do funil pede, para todos os cartões da tela
// de uma vez, e devolve tudo já formatado para exibição.
import { CUSTOM_PREFIX, parseCardFields } from "../lib/cardFields";
import { formatCents, formatDateTime, formatPhone } from "../lib/format";
import { isOverdue } from "../lib/taskTiming";
import { formatCustomRaw } from "./cardHistory";
import type { PipelineType } from "./pipelines";
import { many, one, type DatabaseSync } from "./sql";

export type CardFieldValue =
  /** `phone`/`email`: valor bruto para o link (WhatsApp / provedor de e-mail). */
  | { text: string; tone?: "danger"; label?: string; phone?: string; email?: string }
  | { tags: { name: string; color: string | null }[] };

const DAY = 86_400_000;
const dateOnly = (iso: string | null) => (iso ? formatDateTime(iso).slice(0, 10) : null);
const qty = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

interface Row {
  id: string;
  value_cents: number;
  person_id: string | null;
  organization_id: string | null;
  person_name: string | null;
  person_phone: string | null;
  person_email: string | null;
  org_name: string | null;
  org_city: string | null;
  org_state: string | null;
  org_cnpj: string | null;
  org_segment: string | null;
  org_phone: string | null;
  owner_name: string | null;
  probability: number | null;
  expected_close_at: string | null;
  sla_at: string | null;
  start_at: string | null;
  due_at: string | null;
  description: string | null;
  origin: string | null;
  created_at: string;
  stage_entered_at: string;
  next_task: string | null;
  next_due: string | null;
  next_end: string | null;
  tasks_total: number;
  tasks_done: number;
  notes_count: number;
}

const formatCnpj = (c: string) => (/^\d{14}$/.test(c) ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : c);

/** Configuração do funil (com padrão) e os valores de cada cartão. */
export function cardFieldValues(
  db: DatabaseSync,
  pipelineId: string,
  cardIds: string[],
  opts: { keys?: string[]; now?: Date } = {},
): { keys: string[]; values: Map<string, Record<string, CardFieldValue>> } {
  const now = opts.now ?? new Date();
  const p = one<{ type: PipelineType; card_fields: string | null }>(db, "SELECT type, card_fields FROM pipeline WHERE id = ?", pipelineId);
  // `keys` = prévia de uma configuração ainda não salva.
  const keys = opts.keys ?? (p ? parseCardFields(p.card_fields, p.type) : []);
  const values = new Map<string, Record<string, CardFieldValue>>();
  if (!keys.length || !cardIds.length) return { keys, values };
  const marks = cardIds.map(() => "?").join(", ");
  const rows = many<Row>(
    db,
    `SELECT d.id, d.value_cents, d.person_id, d.organization_id, pe.name AS person_name, pe.phone AS person_phone, pe.email AS person_email,
       o.name AS org_name, o.city AS org_city, o.state AS org_state, o.cnpj AS org_cnpj, o.segment AS org_segment, o.phone AS org_phone,
       u.name AS owner_name, s.probability, d.expected_close_at, d.sla_at, d.start_at, d.due_at, d.description, d.origin, d.created_at, d.stage_entered_at,
       (SELECT a.title FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 ORDER BY COALESCE(a.end_at, a.due_at) LIMIT 1) AS next_task,
       (SELECT COALESCE(a.end_at, a.due_at) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 ORDER BY COALESCE(a.end_at, a.due_at) LIMIT 1) AS next_due,
       (SELECT a.end_at FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 ORDER BY COALESCE(a.end_at, a.due_at) LIMIT 1) AS next_end,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL) AS tasks_total,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 1) AS tasks_done,
       (SELECT COUNT(*) FROM note n WHERE n.entity_type = 'deal' AND n.entity_id = d.id AND n.deleted_at IS NULL) AS notes_count
     FROM deal d JOIN stage s ON s.id = d.stage_id
     LEFT JOIN person pe ON pe.id = d.person_id LEFT JOIN organization o ON o.id = d.organization_id LEFT JOIN app_user u ON u.id = d.owner_id
     WHERE d.id IN (${marks})`,
    ...cardIds,
  );

  const tags = new Map<string, { name: string; color: string | null }[]>();
  if (keys.includes("tags")) {
    for (const t of many<{ entity_id: string; name: string; color: string | null }>(
      db,
      `SELECT et.entity_id, t.name, t.color FROM entity_tag et JOIN tag t ON t.id = et.tag_id AND t.deleted_at IS NULL
       WHERE et.deleted_at IS NULL AND et.entity_id IN (${marks}) ORDER BY t.name COLLATE NOCASE`,
      ...cardIds,
    )) {
      tags.set(t.entity_id, [...(tags.get(t.entity_id) ?? []), { name: t.name, color: t.color }]);
    }
  }

  const items = new Map<string, { description: string; quantity: number }[]>();
  if (keys.includes("produtos")) {
    for (const i of many<{ deal_id: string; description: string; quantity: number }>(
      db,
      `SELECT deal_id, description, quantity FROM deal_item WHERE deleted_at IS NULL AND deal_id IN (${marks}) ORDER BY position`,
      ...cardIds,
    )) {
      items.set(i.deal_id, [...(items.get(i.deal_id) ?? []), i]);
    }
  }

  // Campos personalizados: do cartão, do contato e da organização.
  const custom = keys.filter((k) => k.includes(":")).map((k) => ({ key: k, prefix: k.slice(0, k.indexOf(":") + 1), fieldId: k.slice(k.indexOf(":") + 1) }));
  const customValues = new Map<string, string>(); // `${entityId}|${fieldId}` → texto
  const fieldInfo = new Map<string, { name: string; field_type: string }>();
  if (custom.length) {
    const fieldIds = [...new Set(custom.map((c) => c.fieldId))];
    for (const f of many<{ id: string; name: string; field_type: string }>(
      db,
      `SELECT id, name, field_type FROM custom_field WHERE deleted_at IS NULL AND id IN (${fieldIds.map(() => "?").join(", ")})`,
      ...fieldIds,
    ))
      fieldInfo.set(f.id, f);
    const entityIds = [...new Set([...cardIds, ...rows.flatMap((r) => [r.person_id, r.organization_id]).filter((x): x is string => !!x)])];
    const lookup = (sql: string) => new Map(many<{ id: string; v: string }>(db, sql).map((r) => [r.id, r.v]));
    const names = {
      options: lookup("SELECT id, label AS v FROM custom_field_option"),
      users: lookup("SELECT id, name AS v FROM app_user"),
      persons: lookup("SELECT id, name AS v FROM person"),
      orgs: lookup("SELECT id, name AS v FROM organization"),
      documents: lookup("SELECT id, name AS v FROM document"),
    };
    for (const v of many<{ entity_id: string; field_id: string; value: string }>(
      db,
      `SELECT entity_id, field_id, value FROM custom_field_value WHERE deleted_at IS NULL
       AND field_id IN (${fieldIds.map(() => "?").join(", ")}) AND entity_id IN (${entityIds.map(() => "?").join(", ")})`,
      ...fieldIds,
      ...entityIds,
    )) {
      const f = fieldInfo.get(v.field_id);
      if (f) customValues.set(`${v.entity_id}|${v.field_id}`, formatCustomRaw(v.value, f.field_type, names));
    }
  }

  for (const r of rows) {
    const out: Record<string, CardFieldValue> = {};
    const put = (k: string, text: string | null | undefined, tone?: "danger") => {
      if (text) out[k] = tone ? { text, tone } : { text };
    };
    for (const k of keys) {
      switch (k) {
        case "valor":
          put(k, formatCents(r.value_cents));
          break;
        case "produtos": {
          const list = items.get(r.id) ?? [];
          put(k, list.map((i) => (i.quantity === 1 ? i.description : `${qty(i.quantity)}× ${i.description}`)).join(", "));
          break;
        }
        case "probabilidade":
          put(k, r.probability == null ? null : `${r.probability}%`);
          break;
        case "previsao_fechamento":
          put(k, dateOnly(r.expected_close_at), r.expected_close_at && r.expected_close_at < now.toISOString() ? "danger" : undefined);
          break;
        case "sla":
          put(k, r.sla_at ? formatDateTime(r.sla_at) : null, r.sla_at && r.sla_at < now.toISOString() ? "danger" : undefined);
          break;
        case "inicio":
          put(k, dateOnly(r.start_at));
          break;
        case "prazo":
          put(k, dateOnly(r.due_at), r.due_at && r.due_at < now.toISOString() ? "danger" : undefined);
          break;
        case "descricao":
          put(k, r.description && r.description.length > 90 ? `${r.description.slice(0, 90)}…` : r.description);
          break;
        case "etapa_dias": {
          const d = Math.floor((now.getTime() - new Date(r.stage_entered_at).getTime()) / DAY);
          put(k, d <= 0 ? "hoje" : d === 1 ? "1 dia" : `${d} dias`);
          break;
        }
        case "proxima_tarefa":
          put(k, r.next_task ? `${r.next_task} · ${formatDateTime(r.next_due!)}` : null, r.next_due && isOverdue({ due_at: r.next_due, end_at: r.next_end, done: 0 }, now) ? "danger" : undefined);
          break;
        case "tarefas":
          put(k, r.tasks_total ? `${r.tasks_done}/${r.tasks_total}` : null);
          break;
        case "notas":
          put(k, r.notes_count ? String(r.notes_count) : null);
          break;
        case "tags": {
          const list = tags.get(r.id);
          if (list?.length) out[k] = { tags: list };
          break;
        }
        case "responsavel":
          put(k, r.owner_name);
          break;
        case "origem":
          put(k, r.origin);
          break;
        case "criado_em":
          put(k, dateOnly(r.created_at));
          break;
        case "contato":
          // Sem contato, mostra a organização (como o cartão sempre fez).
          put(k, r.person_name ?? (keys.includes("organizacao") ? null : r.org_name));
          break;
        case "contato_telefone":
          if (r.person_phone) out[k] = { text: formatPhone(r.person_phone), phone: r.person_phone };
          break;
        case "contato_email":
          if (r.person_email) out[k] = { text: r.person_email, email: r.person_email };
          break;
        case "organizacao":
          put(k, r.org_name);
          break;
        case "org_cidade":
          put(k, [r.org_city, r.org_state].filter(Boolean).join(" / "));
          break;
        case "org_cnpj":
          put(k, r.org_cnpj ? formatCnpj(r.org_cnpj) : null);
          break;
        case "org_segmento":
          put(k, r.org_segment);
          break;
        case "org_telefone":
          if (r.org_phone) out[k] = { text: formatPhone(r.org_phone), phone: r.org_phone };
          break;
        default: {
          // Campo personalizado (cf:, pcf:, ocf:), na mesma posição da lista.
          const c = custom.find((x) => x.key === k);
          if (!c) break;
          const entity = c.prefix === CUSTOM_PREFIX.deal ? r.id : c.prefix === CUSTOM_PREFIX.person ? r.person_id : r.organization_id;
          const text = entity ? customValues.get(`${entity}|${c.fieldId}`) : undefined;
          if (text) out[k] = { text, label: fieldInfo.get(c.fieldId)?.name };
        }
      }
    }
    values.set(r.id, out);
  }
  return { keys, values };
}
