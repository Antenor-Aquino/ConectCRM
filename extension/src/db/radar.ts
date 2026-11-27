// Radar Caixa Escolar MG (spec 25): os orçamentos que o robô local acha no
// portal Caixa Escolar (SEE-MG) viram cartões num funil comercial e
// acompanham o processo até o resultado. O service worker lê o Radar
// (http://127.0.0.1:8765/api/crm/oportunidades, só leitura) e manda a lista
// para cá. Vínculos em external_ref (provider "radar"):
//   - deal: external_id = idBudget do portal; source_updated_at guarda o que
//     já foi aplicado ao cartão (JSON RadarAplicado), para nunca repetir nem
//     voltar etapa;
//   - organization: external_id = "inep:<INEP>" ou "email:<e-mail>" da escola.
// O prazo de envio da proposta vira a atividade "Enviar proposta no portal"
// (lembrete 1 dia antes), concluída sozinha quando a proposta aparece enviada.
// Regras: o cartão só avança (entrada → proposta enviada → resultado). Com o
// resultado no portal (aprovada, recusada ou cancelada) o cartão fica
// "Pendente": o desfecho final (ganho/perdido) é decisão do usuário. Se o
// usuário já fechou o cartão à mão, o Radar não mexe no status; cartão
// excluído no CRM não volta.
import { createActivity, updateActivity } from "./activities";
import { createOrganization, findOrganizationByCnpj } from "./contacts";
import { getCustomValues, listCustomFields, setCustomValues, type CustomValue } from "./customFields";
import { createCard, getCardRow, moveCard, setCardStatus, updateCard } from "./deals";
import { addNote } from "./notes";
import { listStages } from "./pipelines";
import { createTag, getEntityTags, listTags, setEntityTags } from "./tags";
import { insertRow, updateRow, type DbContext } from "./repo";
import { one, withTransaction, type DatabaseSync } from "./sql";

export const RADAR_PROVIDER = "radar";
export const RADAR_ORIGIN = "Radar Caixa Escolar MG";

export type RadarStatusPortal = "ENVI" | "APRO" | "RECU" | "CANC";

/** Uma oportunidade como o Radar manda (rota /api/crm/oportunidades). */
export interface RadarOportunidade {
  id: number;
  pedido: string | null;
  escola: string;
  municipio: string;
  grupo?: string | null;
  link: string;
  emailEscola?: string | null;
  cnpjEscola?: string | null;
  censo?: { inep: string; nome?: string | null; turmas?: number | null; endereco?: string | null; telefone?: string | null } | null;
  termos: string[];
  iniciativa?: string | null;
  itens: { descricao?: string | null; tipo?: string | null; quantidade?: string | null; unidade?: string | null; garantia?: string | null }[];
  valorEstimado?: number | null;
  prazoEnvio?: string | null;
  entrega?: string | null;
  encontradoEm?: string | null;
  situacao: "nova" | "tratada" | "descartada";
  arquivado: boolean;
  foraDaListagem: boolean;
  statusPortal?: RadarStatusPortal | null;
  statusPortalEm?: string | null;
  motivoCancelamento?: string | null;
  meuValor?: number | null;
  apuracao?: {
    total: number;
    posicao: number | null;
    meuValor: number | null;
    vencedor: string | null;
    valorVencedor: number | null;
    venci: boolean;
    participantes: { nome: string; valor: number | null; posicao: number; vencedor: boolean; eu: boolean }[];
  } | null;
}

/** De onde começar ao ligar a integração. */
export type RadarInicio = "novas" | "abertas" | "historico";

export interface RadarSyncConfig {
  pipelineId: string;
  /** Etapa dos orçamentos novos (vazio = primeira etapa do funil). */
  stageEntrada?: string | null;
  /** Etapa ao enviar a proposta no portal (vazio = não move). */
  stageEnviada?: string | null;
  /** Etapa ao ganhar (vazio = não move; o cartão fica Ganho onde estiver). */
  stageGanha?: string | null;
  /** Só os orçamentos com alguma destas palavras-chave (vazio = todos). */
  termos?: string[];
  inicio: RadarInicio;
  /** Quando a integração foi ligada (ISO): referência de "novas" e "abertas". */
  ativadoEm: string;
}

export type RadarEstado = "entrada" | "enviada" | "ganha" | "perdida" | "cancelada";
const RANK: Record<RadarEstado, number> = { entrada: 0, enviada: 1, ganha: 2, perdida: 2, cancelada: 2 };

/** O que já foi aplicado ao cartão (fica em external_ref.source_updated_at). */
interface RadarAplicado {
  e: RadarEstado;
  /** Valor da proposta já levado ao cartão. */
  v?: number | null;
  /** Nota do mapa de apuração já criada. */
  m?: boolean;
  /** Atividade "Enviar proposta no portal" criada pelo Radar. */
  a?: string | null;
  /** Notas, campos (Processo SGD, Qtd Turmas) e etiquetas (MG, Pública) já aplicados. */
  x?: number;
}

/** Versão do pacote "notas + campos + etiquetas"; cartões com x menor recebem uma vez. */
const EXTRAS_VERSAO = 1;
export const RADAR_TAGS = ["MG", "Pública"];

export interface RadarSyncItem {
  kind: "created" | "sent" | "won" | "lost" | "canceled";
  dealId: string;
  title: string;
}

export interface RadarSyncResult {
  created: number;
  updated: number;
  skipped: number;
  items: RadarSyncItem[];
  errors: { id: number; error: string }[];
}

export function radarEstado(o: Pick<RadarOportunidade, "statusPortal">): RadarEstado {
  switch (o.statusPortal) {
    case "APRO":
      return "ganha";
    case "RECU":
      return "perdida";
    case "CANC":
      return "cancelada";
    case "ENVI":
      return "enviada";
    default:
      return "entrada";
  }
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Passa no filtro de palavras-chave (vazio = todas). */
export function radarTemTermo(o: Pick<RadarOportunidade, "termos">, termos: string[] | undefined): boolean {
  const quer = (termos ?? []).map(semAcento).filter(Boolean);
  if (!quer.length) return true;
  return o.termos.some((t) => quer.includes(semAcento(t)));
}

/** Pode virar cartão novo, conforme as configurações (o que já tem cartão segue sempre). */
export function radarElegivel(o: RadarOportunidade, cfg: RadarSyncConfig): boolean {
  if (o.situacao === "descartada") return false;
  if (o.arquivado && !o.statusPortal) return false;
  if (!radarTemTermo(o, cfg.termos)) return false;
  if (cfg.inicio === "historico") return true;
  const nova = !!o.encontradoEm && new Date(o.encontradoEm).getTime() >= new Date(cfg.ativadoEm).getTime();
  if (nova) return true;
  if (cfg.inicio === "novas") return false;
  // "abertas": ainda no prazo na listagem do portal, ou proposta enviada aguardando resultado.
  const noPrazo = !o.foraDaListagem && (!o.prazoEnvio || new Date(o.prazoEnvio).getTime() > Date.now());
  return noPrazo || o.statusPortal === "ENVI";
}

const moeda = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const toCents = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v < 0 ? 0 : Math.round(v * 100));

/** Valor do cartão: a proposta enviada; senão o estimado (o portal usa R$ 1,00 quando a escola não estima). */
function valorCartao(o: RadarOportunidade): number {
  if (o.meuValor != null && o.meuValor > 0) return toCents(o.meuValor);
  return o.valorEstimado != null && o.valorEstimado > 1 ? toCents(o.valorEstimado) : 0;
}

export function radarTitulo(o: RadarOportunidade): string {
  return `${o.escola || "Escola"}${o.pedido ? ` — Pedido ${o.pedido}` : ""}`.slice(0, 200);
}

export function radarDescricao(o: RadarOportunidade): string {
  const l: string[] = ["Orçamento do portal Caixa Escolar (SEE-MG), trazido pelo Radar Caixa Escolar MG."];
  l.push([o.pedido && `Pedido: ${o.pedido}`, o.municipio && `Município: ${o.municipio}`, o.grupo && `Grupo: ${o.grupo}`].filter(Boolean).join(" · "));
  if (o.censo) l.push([o.censo.turmas != null && `Turmas (Censo): ${o.censo.turmas}`, `INEP: ${o.censo.inep}`].filter(Boolean).join(" · "));
  if (o.termos.length) l.push(`Palavras-chave: ${o.termos.join(", ")}`);
  if (o.valorEstimado != null && o.valorEstimado > 1) l.push(`Valor estimado pela escola: ${moeda(o.valorEstimado)}`);
  if (o.itens.length) {
    l.push("Itens:");
    for (const i of o.itens.slice(0, 20)) {
      const qtd = i.quantidade ? `${Number(i.quantidade).toLocaleString("pt-BR")} ${i.unidade ?? ""}`.trim() : "";
      l.push(`- ${[qtd, i.tipo, i.descricao].filter(Boolean).join(" — ")}`.slice(0, 600));
    }
    if (o.itens.length > 20) l.push(`(+${o.itens.length - 20} itens)`);
  }
  if (o.link) l.push(`Abrir no portal: ${o.link}`);
  return l.join("\n");
}

const RESULTADO: Partial<Record<RadarEstado, string>> = { ganha: "APROVADA", perdida: "RECUSADA", cancelada: "CANCELADA" };
const temMapa = (o: RadarOportunidade) => !!o.apuracao?.participantes.length;

/** Nota do resultado: status no portal e o resumo do mapa de apuração (se o Radar já leu). */
export function radarNotaResultado(o: RadarOportunidade, e: RadarEstado): string | null {
  const st = RESULTADO[e];
  const a = o.apuracao;
  if (!st && !temMapa(o)) return null;
  const l = [`Resultado no portal (pedido ${o.pedido ?? o.id}): ${st ?? "mapa de apuração publicado"}${e === "ganha" && a?.venci ? " — você venceu" : ""}`];
  if (e === "cancelada") l.push(`Motivo: ${o.motivoCancelamento || "não informado pelo portal"}`);
  if (a && temMapa(o)) {
    const meu = a.meuValor ?? o.meuValor ?? null;
    l.push(
      [
        a.posicao ? `Sua posição: ${a.posicao}º de ${a.total}` : `${a.total} participante(s)`,
        meu != null && `seu valor ${moeda(meu)}`,
        a.venci ? null : `vencedor ${a.vencedor ?? "não informado"} (${moeda(a.valorVencedor)})`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    l.push("", "Mapa de apuração:");
    for (const p of a.participantes) {
      const dif = !p.eu && meu && p.valor != null ? ` (${p.valor >= meu ? "+" : ""}${(((p.valor - meu) / meu) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do seu)` : "";
      l.push(`${p.posicao}º ${p.nome}${p.eu ? " (você)" : ""}${p.vencedor ? " · vencedor" : ""} — ${moeda(p.valor)}${dif}`);
    }
  } else if (e !== "cancelada") {
    l.push("O mapa de apuração ainda não foi lido pelo Radar; quando for, entra numa nota nova.");
  }
  return l.join("\n");
}

const dataHora = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const limpo = (t: string | null | undefined) => (t ?? "").trim();

/** Um texto por item; com mais de um item, numera. Vazio se nenhum item tem o campo. */
function porItem(o: RadarOportunidade, campo: "descricao" | "garantia"): string {
  const itens = o.itens.map((i, n) => ({ n: n + 1, tipo: limpo(i.tipo), texto: limpo(i[campo]) })).filter((i) => i.texto);
  if (!itens.length) return "";
  if (o.itens.length === 1) return itens[0]!.texto;
  return itens.map((i) => `Item ${i.n}${i.tipo ? ` (${i.tipo})` : ""}: ${i.texto}`).join("\n\n");
}

/** As três notas do orçamento: descrição do processo, garantia exigida e contato/prazos. */
export function radarNotas(o: RadarOportunidade): string[] {
  const ped = o.pedido ?? String(o.id);
  const notas: string[] = [];
  const desc = porItem(o, "descricao");
  if (desc) notas.push(`Descrição do processo (pedido ${ped}):\n${desc}`);
  const gar = porItem(o, "garantia");
  if (gar) notas.push(`Garantia exigida (pedido ${ped}):\n${gar}`);
  const emails = (o.emailEscola ?? "").split(/[;,\s]+/).filter(Boolean);
  notas.push(
    [
      `Contato e prazos (pedido ${ped}):`,
      `E-mail da escola: ${emails.join("; ") || "não informado"}`,
      `Envio da proposta: ${dataHora(o.prazoEnvio)}`,
      `Entrega: ${dataHora(o.entrega)}`,
    ].join("\n"),
  );
  return notas;
}

const chaveNome = (s: string) => semAcento(s).replace(/\s+/g, " ");

/** Preenche Processo SGD e Qtd Turmas (campos do cartão achados pelo nome), sem apagar o que o usuário digitou. */
function preencherCampos(db: DatabaseSync, ctx: DbContext, dealId: string, pipelineId: string, o: RadarOportunidade): void {
  const campos = listCustomFields(db, "deal", { pipelineId });
  const atuais = getCustomValues(db, dealId);
  const valores: Record<string, CustomValue> = {};
  const por = (nomes: string[]) => campos.find((f) => nomes.includes(chaveNome(f.name)));
  const poe = (nomes: string[], v: string | number | null | undefined) => {
    const f = por(nomes);
    if (!f || v == null || v === "" || atuais[f.id] !== undefined) return;
    if (f.field_type === "number") valores[f.id] = Number(v);
    else if (["text", "textarea"].includes(f.field_type)) valores[f.id] = String(v);
  };
  poe(["processo sgd"], o.pedido);
  poe(["qtd turmas", "qtd. turmas", "quantidade de turmas", "turmas"], o.censo?.turmas ?? null);
  for (const [id, v] of Object.entries(valores)) {
    try {
      setCustomValues(db, ctx, "deal", dealId, { [id]: v }, { pipelineId });
    } catch {
      // Valor fora do formato do campo: fica em branco, sem impedir o resto.
    }
  }
}

/** Acrescenta as etiquetas MG e Pública (cria se não existirem), mantendo as que o cartão já tem. */
function vincularEtiquetas(db: DatabaseSync, ctx: DbContext, dealId: string): void {
  const todas = listTags(db, "deal", { includeInactive: true });
  const ids = RADAR_TAGS.map((nome) => todas.find((t) => chaveNome(t.name) === chaveNome(nome))?.id ?? createTag(db, ctx, { entity: "deal", name: nome }));
  const atuais = getEntityTags(db, dealId).map((t) => t.id);
  if (ids.every((id) => atuais.includes(id))) return;
  setEntityTags(db, ctx, "deal", dealId, [...new Set([...atuais, ...ids])]);
}

/** Notas, campos e etiquetas: uma vez por cartão (cartões antigos recebem na próxima leitura). */
function aplicarExtras(db: DatabaseSync, ctx: DbContext, dealId: string, o: RadarOportunidade): void {
  const card = getCardRow(db, dealId);
  if (!card) return;
  for (const n of radarNotas(o)) addNote(db, ctx, "deal", dealId, n);
  preencherCampos(db, ctx, dealId, card.pipeline_id, o);
  vincularEtiquetas(db, ctx, dealId);
}

function ref(db: DatabaseSync, entity: "deal" | "organization", externalId: string) {
  return one<{ id: string; local_id: string; source_updated_at: string | null }>(
    db,
    "SELECT id, local_id, source_updated_at FROM external_ref WHERE provider = ? AND entity_type = ? AND external_id = ? AND deleted_at IS NULL",
    RADAR_PROVIDER,
    entity,
    externalId,
  );
}

function link(db: DatabaseSync, ctx: DbContext, entity: "deal" | "organization", externalId: string, localId: string, aplicado: string | null): void {
  insertRow(db, ctx, "external_ref", {
    provider: RADAR_PROVIDER,
    entity_type: entity,
    external_id: externalId,
    local_id: localId,
    source_updated_at: aplicado,
    imported_at: new Date().toISOString(),
  });
}

/** Chave da escola: INEP do Censo; senão o e-mail institucional. */
function chaveEscola(o: RadarOportunidade): string | null {
  if (o.censo?.inep) return `inep:${o.censo.inep}`;
  const email = (o.emailEscola ?? "").split(/[;,\s]+/).find(Boolean);
  return email ? `email:${email.toLowerCase()}` : null;
}

/** Organização da escola: a já vinculada, a de mesmo CNPJ ou mesmo nome e cidade; senão cria. */
function organizacaoDaEscola(db: DatabaseSync, ctx: DbContext, o: RadarOportunidade): string | null {
  const chave = chaveEscola(o);
  if (chave) {
    const r = ref(db, "organization", chave);
    if (r && one(db, "SELECT 1 FROM organization WHERE id = ? AND deleted_at IS NULL", r.local_id)) return r.local_id;
  }
  const cnpj = (o.cnpjEscola ?? "").replace(/\D/g, "");
  let id =
    (cnpj.length === 14 ? findOrganizationByCnpj(db, cnpj)?.id : undefined) ??
    one<{ id: string }>(
      db,
      "SELECT id FROM organization WHERE lower(name) = lower(?) AND lower(coalesce(city, '')) = lower(?) AND deleted_at IS NULL ORDER BY created_at LIMIT 1",
      o.escola,
      o.municipio ?? "",
    )?.id;
  if (!id) {
    const end = o.censo?.endereco ?? "";
    const cep = /CEP\s*([\d.-]{8,10})/i.exec(end)?.[1] ?? null;
    const base = { name: o.escola || "Escola", orgType: "cliente" as const, city: o.municipio || null, state: "MG", segment: "Escola estadual (MG)" };
    const extras = {
      cnpj: cnpj.length === 14 ? cnpj : null,
      email: (o.emailEscola ?? "").split(/[;,\s]+/).find(Boolean) ?? null,
      phone: o.censo?.telefone ?? null,
      street: end ? end.replace(/\s*-\s*[^-]*\/MG.*$/i, "").trim() || null : null,
      cep: cep ? cep.replace(/\D/g, "") : null,
      description: o.censo?.inep ? `INEP ${o.censo.inep}` : null,
    };
    try {
      id = createOrganization(db, ctx, { ...base, ...extras });
    } catch {
      // Algum dado fora do formato que o CRM aceita (telefone, CEP...): cadastra o essencial.
      id = createOrganization(db, ctx, { ...base, description: extras.description });
    }
  }
  if (chave && !ref(db, "organization", chave)) link(db, ctx, "organization", chave, id, null);
  return id;
}

function stageDoFunil(db: DatabaseSync, pipelineId: string, stageId: string | null | undefined): string | null {
  if (!stageId) return null;
  return listStages(db, pipelineId).some((s) => s.id === stageId) ? stageId : null;
}

/** Leva o cartão ao estado novo: etapa (se configurada) e, com o resultado no portal, Pendente
 * (o usuário avalia e define ganho/perdido). Não mexe em cartão já fechado à mão. */
function aplicarEstado(db: DatabaseSync, ctx: DbContext, cfg: RadarSyncConfig, dealId: string, o: RadarOportunidade, e: RadarEstado): void {
  const card = getCardRow(db, dealId);
  if (!card || card.status !== "open") return;
  const alvo =
    e === "enviada" ? stageDoFunil(db, cfg.pipelineId, cfg.stageEnviada) : e === "ganha" ? stageDoFunil(db, cfg.pipelineId, cfg.stageGanha) : null;
  if (alvo && card.pipeline_id === cfg.pipelineId && card.stage_id !== alvo) moveCard(db, ctx, dealId, { stageId: alvo });
  if (RESULTADO[e]) setCardStatus(db, ctx, dealId, { status: "pending" });
}

const ITEM_KIND: Record<RadarEstado, RadarSyncItem["kind"] | null> = { entrada: null, enviada: "sent", ganha: "won", perdida: "lost", cancelada: "canceled" };

/** Cria ou atualiza os cartões. Repetir a mesma lista não muda nada. */
export function syncRadar(db: DatabaseSync, ctx: DbContext, cfg: RadarSyncConfig, lista: RadarOportunidade[]): RadarSyncResult {
  const out: RadarSyncResult = { created: 0, updated: 0, skipped: 0, items: [], errors: [] };
  if (!one(db, "SELECT 1 FROM pipeline WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL", cfg.pipelineId))
    throw new Error("O funil escolhido para o Radar não existe mais ou está arquivado. Escolha outro em Configurações → Integrações → Radar.");
  for (const o of lista) {
    try {
      withTransaction(db, () => {
        const extId = String(o.id);
        const r = ref(db, "deal", extId);
        const e = radarEstado(o);
        if (!r) {
          if (!radarElegivel(o, cfg)) {
            out.skipped++;
            return;
          }
          const orgId = organizacaoDaEscola(db, ctx, o);
          const stageId = stageDoFunil(db, cfg.pipelineId, e === "entrada" ? cfg.stageEntrada : (cfg.stageEnviada ?? cfg.stageEntrada)) ?? undefined;
          const dealId = createCard(db, ctx, {
            pipelineId: cfg.pipelineId,
            stageId,
            title: radarTitulo(o),
            description: radarDescricao(o),
            valueCents: valorCartao(o),
            expectedCloseAt: o.entrega ?? null,
            organizationId: orgId,
            origin: RADAR_ORIGIN,
          });
          const aplicado: RadarAplicado = { e: "entrada", v: o.meuValor ?? null };
          if (e === "entrada" && o.prazoEnvio && new Date(o.prazoEnvio).getTime() > Date.now())
            aplicado.a = createActivity(db, ctx, {
              title: `Enviar proposta no portal — pedido ${o.pedido ?? o.id}`,
              description: `Prazo de envio da proposta no portal Caixa Escolar.${o.link ? `
${o.link}` : ""}`,
              dueAt: o.prazoEnvio,
              reminderMin: 24 * 60,
              dealId,
            });
          aplicarExtras(db, ctx, dealId, o);
          aplicado.x = EXTRAS_VERSAO;
          if (e !== "entrada") aplicarEstado(db, ctx, cfg, dealId, o, e);
          aplicado.e = e;
          const nota = radarNotaResultado(o, e);
          if (nota) {
            addNote(db, ctx, "deal", dealId, nota);
            aplicado.m = temMapa(o);
          }
          link(db, ctx, "deal", extId, dealId, JSON.stringify(aplicado));
          out.created++;
          out.items.push({ kind: "created", dealId, title: radarTitulo(o) });
          return;
        }
        // Já tem cartão: só avança.
        if (!one(db, "SELECT 1 FROM deal WHERE id = ? AND deleted_at IS NULL", r.local_id)) {
          out.skipped++; // excluído no CRM: não volta
          return;
        }
        let antes: RadarAplicado;
        try {
          antes = JSON.parse(r.source_updated_at ?? "") as RadarAplicado;
        } catch {
          antes = { e: "entrada" };
        }
        const depois: RadarAplicado = { ...antes };
        let mudou = false;
        if ((antes.x ?? 0) < EXTRAS_VERSAO) {
          aplicarExtras(db, ctx, r.local_id, o);
          depois.x = EXTRAS_VERSAO;
          mudou = true;
        }
        let notaFeita = false;
        if (RANK[e] > RANK[antes.e]) {
          aplicarEstado(db, ctx, cfg, r.local_id, o, e);
          // Saiu o resultado (aprovada, recusada ou cancelada): nota nova com o resumo da apuração.
          const notaRes = RESULTADO[e] ? radarNotaResultado(o, e) : null;
          if (notaRes) {
            addNote(db, ctx, "deal", r.local_id, notaRes);
            if (temMapa(o)) depois.m = true;
            notaFeita = true;
          }
          if (antes.a && one(db, "SELECT 1 FROM activity WHERE id = ? AND done = 0 AND deleted_at IS NULL", antes.a))
            updateActivity(db, ctx, antes.a, { done: true });
          depois.e = e;
          mudou = true;
          const k = ITEM_KIND[e];
          if (k) out.items.push({ kind: k, dealId: r.local_id, title: radarTitulo(o) });
        }
        if (o.meuValor != null && o.meuValor > 0 && antes.v !== o.meuValor) {
          updateCard(db, ctx, r.local_id, { valueCents: toCents(o.meuValor) });
          depois.v = o.meuValor;
          mudou = true;
        }
        // Mapa lido depois do resultado (ou numa leitura seguinte): nota com o resumo, uma vez.
        const nota = !notaFeita && !antes.m && temMapa(o) ? radarNotaResultado(o, e) : null;
        if (nota) {
          addNote(db, ctx, "deal", r.local_id, nota);
          depois.m = true;
          mudou = true;
        }
        if (mudou) {
          updateRow(db, ctx, "external_ref", r.id, { source_updated_at: JSON.stringify(depois), imported_at: new Date().toISOString() });
          out.updated++;
        }
      });
    } catch (err) {
      out.errors.push({ id: o.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** Quantos cartões vieram do Radar (para a tela de configurações). */
export function radarResumo(db: DatabaseSync): { cartoes: number; abertos: number } {
  const r = one<{ n: number; abertos: number }>(
    db,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN d.status IN ('open', 'pending') THEN 1 ELSE 0 END) AS abertos
     FROM external_ref x JOIN deal d ON d.id = x.local_id AND d.deleted_at IS NULL
     WHERE x.provider = ? AND x.entity_type = 'deal' AND x.deleted_at IS NULL`,
    RADAR_PROVIDER,
  );
  return { cartoes: r?.n ?? 0, abertos: r?.abertos ?? 0 };
}
