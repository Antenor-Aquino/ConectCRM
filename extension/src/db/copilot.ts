// Consultas do Copiloto de IA (Fase 11). A IA nunca recebe o banco nem faz
// contas: escolhe uma destas consultas e recebe o resultado já calculado,
// com valores formatados e dias contados aqui. Tudo respeita a permissão do
// usuário (mesmas regras do quadro e das tarefas). Nomes de funil e de
// responsável são resolvidos aqui; sem correspondência, a resposta traz as
// opções existentes em vez de adivinhar.
import { formatCents, formatDateTime } from "../lib/format";
import { activityScope } from "./activities";
import { cardScope } from "./deals";
import { buildReport } from "./reports";
import { many, type DatabaseSync, type SqlValue } from "./sql";
import { ROLE_LABEL, type Viewer } from "./users";

const DAY = 86_400_000;
const MAX_ROWS = 30;
const KIND = { deal: "negócio", ticket: "ticket", project: "etapa de projeto" } as const;
const STATUS = { open: "aberto", won: "ganho", lost: "perdido" } as const;

const days = (iso: string | null, now: Date) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY)) : null);
const date = (iso: string | null) => (iso ? formatDateTime(iso) : null);
const cut = (s: string | null, n = 400) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
const like = (s: string) => `%${s.trim().replace(/[%_]/g, "")}%`;

export type Resolved = { ids: string[] } | { erro: string; opcoes: string[] };

/** Nome (ou parte) de funil → ids. */
export function resolvePipeline(db: DatabaseSync, name: string | undefined): Resolved | null {
  if (!name?.trim()) return null;
  const all = many<{ id: string; name: string }>(db, "SELECT id, name FROM pipeline WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name");
  const hit = all.filter((p) => p.name.toLowerCase().includes(name.trim().toLowerCase()));
  return hit.length ? { ids: hit.map((p) => p.id) } : { erro: `Nenhum funil com o nome "${name}".`, opcoes: all.map((p) => p.name) };
}

/** Nome (ou parte) de usuário ou equipe → ids de usuários. */
export function resolveOwner(db: DatabaseSync, name: string | undefined): Resolved | null {
  if (!name?.trim()) return null;
  const q = name.trim().toLowerCase();
  const users = many<{ id: string; name: string }>(db, "SELECT id, name FROM app_user WHERE deleted_at IS NULL AND active = 1 ORDER BY name");
  const hit = users.filter((u) => u.name.toLowerCase().includes(q));
  if (hit.length) return { ids: hit.map((u) => u.id) };
  const teams = many<{ id: string; name: string }>(db, "SELECT id, name FROM team WHERE deleted_at IS NULL AND active = 1");
  const team = teams.find((t) => t.name.toLowerCase().includes(q));
  if (team) {
    const ids = many<{ user_id: string }>(db, "SELECT user_id FROM team_member WHERE team_id = ? AND deleted_at IS NULL", team.id).map((r) => r.user_id);
    return { ids: ids.length ? ids : ["-"] };
  }
  return { erro: `Nenhum usuário ou equipe com o nome "${name}".`, opcoes: [...users.map((u) => u.name), ...teams.map((t) => `Equipe ${t.name}`)] };
}

const isErr = (r: Resolved | null): r is { erro: string; opcoes: string[] } => !!r && "erro" in r;

export interface CardSearch {
  texto?: string;
  status?: "open" | "won" | "lost" | "all";
  funil?: string;
  responsavel?: string;
  limite?: number;
}

/** Cartões com etapa, valor, contato, responsável, dias na etapa e próxima tarefa. */
export function searchCardsForCopilot(db: DatabaseSync, viewer: Viewer | null, f: CardSearch, now = new Date()) {
  const pipe = resolvePipeline(db, f.funil);
  if (isErr(pipe)) return pipe;
  const owner = resolveOwner(db, f.responsavel);
  if (isErr(owner)) return owner;
  const where = ["d.deleted_at IS NULL"];
  const params: SqlValue[] = [];
  if (f.texto?.trim()) {
    where.push("(d.title LIKE ? OR pe.name LIKE ? OR o.name LIKE ?)");
    params.push(like(f.texto), like(f.texto), like(f.texto));
  }
  const status = f.status ?? "open";
  if (status !== "all") {
    where.push("d.status = ?");
    params.push(status);
  }
  if (pipe) {
    where.push(`d.pipeline_id IN (${pipe.ids.map(() => "?").join(", ")})`);
    params.push(...pipe.ids);
  }
  if (owner) {
    where.push(`d.owner_id IN (${owner.ids.map(() => "?").join(", ")})`);
    params.push(...owner.ids);
  }
  const scope = cardScope(db, viewer);
  const rows = many<{
    id: string; title: string; kind: keyof typeof KIND; status: keyof typeof STATUS; value_cents: number; pipeline: string; stage: string;
    probability: number | null; person: string | null; organization: string | null; owner: string | null; stage_entered_at: string;
    closed_at: string | null; next_task: string | null; next_due: string | null; overdue: number;
  }>(
    db,
    `SELECT d.id, d.title, d.kind, d.status, d.value_cents, p.name AS pipeline, s.name AS stage, s.probability,
       pe.name AS person, o.name AS organization, u.name AS owner, d.stage_entered_at, d.closed_at,
       (SELECT a.title FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 ORDER BY a.due_at LIMIT 1) AS next_task,
       (SELECT a.due_at FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 ORDER BY a.due_at LIMIT 1) AS next_due,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0 AND a.due_at < ?) AS overdue
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id JOIN stage s ON s.id = d.stage_id
     LEFT JOIN person pe ON pe.id = d.person_id LEFT JOIN organization o ON o.id = d.organization_id
     LEFT JOIN app_user u ON u.id = d.owner_id
     WHERE ${where.join(" AND ")}${scope.sql}
     ORDER BY d.status = 'open' DESC, d.value_cents DESC, d.updated_at DESC`,
    now.toISOString(),
    ...params,
    ...scope.params,
  );
  const limit = Math.min(Math.max(1, f.limite ?? 20), MAX_ROWS);
  return {
    total: rows.length,
    valorTotal: formatCents(rows.reduce((a, r) => a + r.value_cents, 0)),
    mostrando: Math.min(limit, rows.length),
    cartoes: rows.slice(0, limit).map((r) => ({
      id: r.id,
      titulo: r.title,
      tipo: KIND[r.kind],
      status: STATUS[r.status],
      funil: r.pipeline,
      etapa: r.stage,
      probabilidade: r.probability == null ? null : `${r.probability}%`,
      valor: formatCents(r.value_cents),
      contato: r.person,
      organizacao: r.organization,
      responsavel: r.owner ?? "Sem responsável",
      diasNaEtapa: r.status === "open" ? days(r.stage_entered_at, now) : null,
      fechadoEm: date(r.closed_at),
      proximaTarefa: r.next_task ? `${r.next_task} (${date(r.next_due)})` : null,
      tarefasAtrasadas: r.overdue,
    })),
  };
}

/** Tudo de um cartão: dados, itens, tarefas, últimas notas e etapas percorridas. */
export function cardDigest(db: DatabaseSync, viewer: Viewer | null, id: string, now = new Date()) {
  const scope = cardScope(db, viewer);
  const ok = many(db, `SELECT 1 FROM deal d WHERE d.id = ? AND d.deleted_at IS NULL${scope.sql}`, id, ...scope.params).length > 0;
  if (!ok) return { erro: "Cartão não encontrado ou sem permissão de acesso. Use buscar_cartoes para achar o id certo." };
  const base = many<{
    title: string; kind: keyof typeof KIND; status: keyof typeof STATUS; value_cents: number; description: string | null; pipeline: string; stage: string;
    probability: number | null; person: string | null; person_phone: string | null; person_email: string | null; organization: string | null;
    owner: string | null; created_at: string; stage_entered_at: string; closed_at: string | null; expected_close_at: string | null;
    sla_at: string | null; due_at: string | null; origin: string | null; loss_reason: string | null; loss_note: string | null;
  }>(
    db,
    `SELECT d.title, d.kind, d.status, d.value_cents, d.description, p.name AS pipeline, s.name AS stage, s.probability,
       pe.name AS person, pe.phone AS person_phone, pe.email AS person_email, o.name AS organization, u.name AS owner,
       d.created_at, d.stage_entered_at, d.closed_at, d.expected_close_at, d.sla_at, d.due_at, d.origin, lr.name AS loss_reason, d.loss_note
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id JOIN stage s ON s.id = d.stage_id
     LEFT JOIN person pe ON pe.id = d.person_id LEFT JOIN organization o ON o.id = d.organization_id
     LEFT JOIN app_user u ON u.id = d.owner_id LEFT JOIN loss_reason lr ON lr.id = d.loss_reason_id
     WHERE d.id = ?`,
    id,
  )[0]!;
  const tasks = many<{ title: string; due_at: string; done: number; type: string; owner: string | null }>(
    db,
    `SELECT a.title, a.due_at, a.done, t.name AS type, u.name AS owner FROM activity a JOIN activity_type t ON t.id = a.type_id
     LEFT JOIN app_user u ON u.id = a.owner_id WHERE a.deal_id = ? AND a.deleted_at IS NULL ORDER BY a.done, a.due_at DESC LIMIT 20`,
    id,
  );
  const notes = many<{ body: string; created_at: string; author: string | null }>(
    db,
    `SELECT n.body, n.created_at, u.name AS author FROM note n LEFT JOIN app_user u ON u.id = n.created_by
     WHERE n.entity_type = 'deal' AND n.entity_id = ? AND n.deleted_at IS NULL ORDER BY n.created_at DESC LIMIT 10`,
    id,
  );
  const items = many<{ description: string; quantity: number; total_cents: number; recurrence: string }>(
    db,
    "SELECT description, quantity, total_cents, recurrence FROM deal_item WHERE deal_id = ? AND deleted_at IS NULL ORDER BY position",
    id,
  );
  const history = many<{ stage: string; entered_at: string; left_at: string | null }>(
    db,
    `SELECT s.name AS stage, h.entered_at, h.left_at FROM deal_stage_history h JOIN stage s ON s.id = h.stage_id
     WHERE h.deal_id = ? AND h.deleted_at IS NULL ORDER BY h.entered_at`,
    id,
  );
  const attachments = many<{ n: number }>(db, "SELECT COUNT(*) AS n FROM attachment WHERE entity_type = 'deal' AND entity_id = ? AND deleted_at IS NULL", id)[0]!.n;
  const nowIso = now.toISOString();
  return {
    id,
    titulo: base.title,
    tipo: KIND[base.kind],
    status: STATUS[base.status],
    funil: base.pipeline,
    etapa: base.stage,
    probabilidade: base.probability == null ? null : `${base.probability}%`,
    valor: formatCents(base.value_cents),
    descricao: cut(base.description),
    contato: base.person ? { nome: base.person, telefone: base.person_phone, email: base.person_email } : null,
    organizacao: base.organization,
    responsavel: base.owner ?? "Sem responsável",
    origem: base.origin,
    criadoEm: date(base.created_at),
    diasDesdeCriacao: days(base.created_at, now),
    diasNaEtapaAtual: base.status === "open" ? days(base.stage_entered_at, now) : null,
    previsaoFechamento: date(base.expected_close_at),
    sla: date(base.sla_at),
    prazo: date(base.due_at),
    fechadoEm: date(base.closed_at),
    motivoPerda: base.status === "lost" ? (base.loss_reason ?? "não informado") : null,
    observacaoPerda: base.loss_note,
    itens: items.map((i) => ({ descricao: i.description, quantidade: i.quantity, total: formatCents(i.total_cents), recorrencia: i.recurrence })),
    tarefasPendentes: tasks
      .filter((t) => !t.done)
      .map((t) => ({ titulo: t.title, tipo: t.type, quando: date(t.due_at), atrasada: t.due_at < nowIso, responsavel: t.owner })),
    tarefasConcluidasRecentes: tasks.filter((t) => t.done).slice(0, 5).map((t) => ({ titulo: t.title, tipo: t.type, quando: date(t.due_at) })),
    ultimasNotas: notes.map((n) => ({ em: date(n.created_at), autor: n.author, texto: cut(n.body, 600) })),
    etapasPercorridas: history.map((h) => ({ etapa: h.stage, entrou: date(h.entered_at), dias: days(h.entered_at, h.left_at ? new Date(h.left_at) : now) })),
    anexos: attachments,
  };
}

/** Abertos sem movimento: nem mudança de etapa, nem tarefa concluída, nem nota há X dias. */
export function staleDeals(db: DatabaseSync, viewer: Viewer | null, f: { dias?: number; funil?: string; responsavel?: string }, now = new Date()) {
  const pipe = resolvePipeline(db, f.funil);
  if (isErr(pipe)) return pipe;
  const owner = resolveOwner(db, f.responsavel);
  if (isErr(owner)) return owner;
  const where = ["d.deleted_at IS NULL", "d.status = 'open'"];
  const params: SqlValue[] = [];
  if (pipe) {
    where.push(`d.pipeline_id IN (${pipe.ids.map(() => "?").join(", ")})`);
    params.push(...pipe.ids);
  }
  if (owner) {
    where.push(`d.owner_id IN (${owner.ids.map(() => "?").join(", ")})`);
    params.push(...owner.ids);
  }
  const scope = cardScope(db, viewer);
  const rows = many<{ id: string; title: string; value_cents: number; pipeline: string; stage: string; stale_days: number | null; owner: string | null; last: string; pending: number }>(
    db,
    `SELECT d.id, d.title, d.value_cents, p.name AS pipeline, s.name AS stage, s.stale_days, u.name AS owner,
       MAX(d.stage_entered_at,
           COALESCE((SELECT MAX(a.done_at) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 1), ''),
           COALESCE((SELECT MAX(n.created_at) FROM note n WHERE n.entity_type = 'deal' AND n.entity_id = d.id AND n.deleted_at IS NULL), '')) AS last,
       (SELECT COUNT(*) FROM activity a WHERE a.deal_id = d.id AND a.deleted_at IS NULL AND a.done = 0) AS pending
     FROM deal d JOIN pipeline p ON p.id = d.pipeline_id JOIN stage s ON s.id = d.stage_id LEFT JOIN app_user u ON u.id = d.owner_id
     WHERE ${where.join(" AND ")}${scope.sql}`,
    ...params,
    ...scope.params,
  );
  const list = rows
    .map((r) => ({ r, idle: days(r.last, now)!, limit: f.dias ?? r.stale_days ?? 14 }))
    .filter((x) => x.idle >= x.limit)
    .sort((a, b) => b.idle - a.idle);
  return {
    criterio: f.dias ? `sem movimento há ${f.dias} dias ou mais` : "sem movimento além do limite da etapa (ou 14 dias quando a etapa não tem limite)",
    total: list.length,
    valorParado: formatCents(list.reduce((a, x) => a + x.r.value_cents, 0)),
    cartoes: list.slice(0, MAX_ROWS).map(({ r, idle }) => ({
      id: r.id,
      titulo: r.title,
      funil: r.pipeline,
      etapa: r.stage,
      valor: formatCents(r.value_cents),
      responsavel: r.owner ?? "Sem responsável",
      diasSemMovimento: idle,
      ultimoMovimento: date(r.last),
      temTarefaPendente: r.pending > 0,
    })),
  };
}

export type TaskSituation = "atrasadas" | "hoje" | "proximos_7_dias" | "pendentes";

export function tasksForCopilot(db: DatabaseSync, viewer: Viewer | null, f: { situacao?: TaskSituation; responsavel?: string }, now = new Date()) {
  const owner = resolveOwner(db, f.responsavel);
  if (isErr(owner)) return owner;
  const where = ["a.deleted_at IS NULL", "a.done = 0"];
  const params: SqlValue[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const situacao = f.situacao ?? "pendentes";
  if (situacao === "atrasadas") {
    where.push("a.due_at < ?");
    params.push(now.toISOString());
  } else if (situacao === "hoje") {
    where.push("a.due_at >= ? AND a.due_at < ?");
    params.push(start.toISOString(), new Date(start.getTime() + DAY).toISOString());
  } else if (situacao === "proximos_7_dias") {
    where.push("a.due_at >= ? AND a.due_at < ?");
    params.push(now.toISOString(), new Date(start.getTime() + 8 * DAY).toISOString());
  }
  if (owner) {
    where.push(`a.owner_id IN (${owner.ids.map(() => "?").join(", ")})`);
    params.push(...owner.ids);
  }
  const scope = activityScope(db, viewer);
  if (scope.sql) {
    where.push(scope.sql);
    params.push(...scope.params);
  }
  const rows = many<{ title: string; due_at: string; type: string; owner: string | null; deal_id: string | null; deal: string | null; person: string | null }>(
    db,
    `SELECT a.title, a.due_at, t.name AS type, u.name AS owner, d.id AS deal_id, d.title AS deal, pe.name AS person
     FROM activity a JOIN activity_type t ON t.id = a.type_id LEFT JOIN app_user u ON u.id = a.owner_id
     LEFT JOIN deal d ON d.id = a.deal_id AND d.deleted_at IS NULL LEFT JOIN person pe ON pe.id = a.person_id
     WHERE ${where.join(" AND ")} ORDER BY a.due_at`,
    ...params,
  );
  return {
    situacao,
    total: rows.length,
    tarefas: rows.slice(0, MAX_ROWS).map((r) => ({
      titulo: r.title,
      tipo: r.type,
      quando: date(r.due_at),
      atrasadaHaDias: r.due_at < now.toISOString() ? days(r.due_at, now) : null,
      responsavel: r.owner ?? "Sem responsável",
      cartaoId: r.deal_id,
      cartao: r.deal,
      contato: r.person,
    })),
  };
}

/** Contatos e organizações pelo nome, e-mail ou telefone, com os cartões abertos. */
export function contactsForCopilot(db: DatabaseSync, viewer: Viewer | null, texto: string) {
  if (!texto?.trim()) return { erro: "Informe o texto da busca." };
  const scope = cardScope(db, viewer);
  const digits = texto.replace(/\D/g, "");
  const people = many<{ id: string; name: string; phone: string | null; email: string | null; org: string | null }>(
    db,
    `SELECT p.id, p.name, p.phone, p.email,
       (SELECT o.name FROM person_organization po JOIN organization o ON o.id = po.organization_id WHERE po.person_id = p.id AND po.deleted_at IS NULL AND po.is_primary = 1) AS org
     FROM person p WHERE p.deleted_at IS NULL AND (p.is_private = 0 OR ? IS NULL OR p.owner_id = ? OR p.created_by = ? OR ? = 'admin')
       AND (p.name LIKE ? OR p.email LIKE ?${digits.length >= 4 ? " OR p.phone LIKE ?" : ""})
     ORDER BY p.name LIMIT 15`,
    viewer?.id ?? null,
    viewer?.id ?? null,
    viewer?.id ?? null,
    viewer?.role ?? null,
    like(texto),
    like(texto),
    ...(digits.length >= 4 ? [`%${digits}%`] : []),
  );
  const orgs = many<{ id: string; name: string; cnpj: string | null; city: string | null }>(
    db,
    "SELECT id, name, cnpj, city FROM organization WHERE deleted_at IS NULL AND (name LIKE ? OR legal_name LIKE ?) ORDER BY name LIMIT 10",
    like(texto),
    like(texto),
  );
  const cardsOf = (col: string, id: string) =>
    many<{ id: string; title: string; stage: string; value_cents: number }>(
      db,
      `SELECT d.id, d.title, s.name AS stage, d.value_cents FROM deal d JOIN stage s ON s.id = d.stage_id
       WHERE d.${col} = ? AND d.deleted_at IS NULL AND d.status = 'open'${scope.sql} ORDER BY d.updated_at DESC LIMIT 10`,
      id,
      ...scope.params,
    ).map((c) => ({ id: c.id, titulo: c.title, etapa: c.stage, valor: formatCents(c.value_cents) }));
  return {
    contatos: people.map((p) => ({ nome: p.name, telefone: p.phone, email: p.email, organizacao: p.org, cartoesAbertos: cardsOf("person_id", p.id) })),
    organizacoes: orgs.map((o) => ({ nome: o.name, cnpj: o.cnpj, cidade: o.city, cartoesAbertos: cardsOf("organization_id", o.id) })),
  };
}

/** Funis com etapas, usuários e equipes (para resolver nomes e explicar a estrutura). */
export function crmStructure(db: DatabaseSync) {
  const pipelines = many<{ id: string; name: string; type: string }>(db, "SELECT id, name, type FROM pipeline WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY name");
  const stages = many<{ pipeline_id: string; name: string; probability: number | null; stale_days: number | null }>(
    db,
    "SELECT pipeline_id, name, probability, stale_days FROM stage WHERE deleted_at IS NULL ORDER BY position",
  );
  const users = many<{ id: string; name: string; role: keyof typeof ROLE_LABEL }>(db, "SELECT id, name, role FROM app_user WHERE deleted_at IS NULL AND active = 1 ORDER BY name");
  const teams = many<{ id: string; name: string }>(db, "SELECT id, name FROM team WHERE deleted_at IS NULL AND active = 1 ORDER BY name");
  const members = many<{ team_id: string; name: string }>(
    db,
    "SELECT m.team_id, u.name FROM team_member m JOIN app_user u ON u.id = m.user_id WHERE m.deleted_at IS NULL",
  );
  const lossReasons = many<{ name: string }>(db, "SELECT name FROM loss_reason WHERE deleted_at IS NULL AND active = 1 ORDER BY name").map((r) => r.name);
  const types = many<{ name: string }>(db, "SELECT name FROM activity_type WHERE deleted_at IS NULL AND active = 1 ORDER BY name").map((r) => r.name);
  return {
    funis: pipelines.map((p) => ({
      nome: p.name,
      tipo: p.type,
      etapas: stages.filter((s) => s.pipeline_id === p.id).map((s) => ({ nome: s.name, probabilidade: s.probability, paradoApos: s.stale_days })),
    })),
    usuarios: users.map((u) => ({ nome: u.name, papel: ROLE_LABEL[u.role] })),
    equipes: teams.map((t) => ({ nome: t.name, membros: members.filter((m) => m.team_id === t.id).map((m) => m.name) })),
    motivosDePerda: lossReasons,
    tiposDeTarefa: types,
  };
}

/** Resumo comercial (mesmos números da tela de Relatórios), período em datas locais AAAA-MM-DD. */
export function salesSummary(db: DatabaseSync, viewer: Viewer | null, f: { de: string; ate: string; funil?: string; responsavel?: string }) {
  const parse = (s: string, end: boolean) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
    if (!m) return null;
    return new Date(+m[1]!, +m[2]! - 1, +m[3]! + (end ? 1 : 0)).toISOString();
  };
  const from = parse(f.de, false);
  const to = parse(f.ate, true);
  if (!from || !to || from >= to) return { erro: "Período inválido: use de/ate no formato AAAA-MM-DD, com de ≤ ate." };
  const pipe = resolvePipeline(db, f.funil);
  if (isErr(pipe)) return pipe;
  const owner = resolveOwner(db, f.responsavel);
  if (isErr(owner)) return owner;
  const r = buildReport(db, { from, to, pipelineId: pipe?.ids[0] ?? null, ownerIds: owner?.ids ?? null, viewer });
  const pctx = (v: number | null) => (v == null ? null : `${Math.round(v * 1000) / 10}%`);
  const s = r.summary;
  return {
    periodo: `${f.de} a ${f.ate}`,
    funil: f.funil ? (pipe!.ids.length > 1 ? "primeiro funil com esse nome" : f.funil) : "todos os funis comerciais",
    ganhos: { quantidade: s.won.count, valor: formatCents(s.won.valueCents) },
    perdidos: { quantidade: s.lost.count, valor: formatCents(s.lost.valueCents) },
    taxaDeConversao: pctx(s.winRate),
    ticketMedio: s.avgTicketCents == null ? null : formatCents(s.avgTicketCents),
    cicloMedioDias: s.avgCycleDays == null ? null : Math.round(s.avgCycleDays * 10) / 10,
    criadosNoPeriodo: s.created,
    emAbertoHoje: { quantidade: s.open.count, valor: formatCents(s.open.valueCents) },
    previsaoPonderada: formatCents(s.weightedCents),
    previsaoPorEtapa: r.forecast.map((x) => ({ funil: x.pipelineName, etapa: x.stageName, probabilidade: x.probability, cartoes: x.count, valor: formatCents(x.valueCents), ponderado: formatCents(x.weightedCents) })),
    conversaoDoFunil: r.funnel?.map((x) => ({ etapa: x.name, chegaram: x.reached, daEtapaAnterior: pctx(x.fromPrevious) })) ?? null,
    motivosDePerda: r.lossReasons.map((x) => ({ motivo: x.reason, quantidade: x.count, valor: formatCents(x.valueCents) })),
    porResponsavel: r.owners.map((o) => ({ nome: o.name, ganhos: o.won, valorGanho: formatCents(o.wonValueCents), perdidos: o.lost, conversao: pctx(o.winRate), abertos: o.open, ponderado: formatCents(o.weightedCents) })),
    produtosVendidos: r.products.slice(0, 10).map((p) => ({ nome: p.name, quantidade: p.quantity, total: formatCents(p.totalCents) })),
  };
}
