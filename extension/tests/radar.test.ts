// Radar Caixa Escolar MG (spec 25): orçamentos viram cartões, sem duplicar, e só avançam até o resultado.
import { describe, expect, it } from "vitest";
import { listActivities } from "../src/db/activities";
import { createCustomField, getCustomValues, setCustomValues } from "../src/db/customFields";
import { updateRow } from "../src/db/repo";
import { createTag, getEntityTags } from "../src/db/tags";
import { getOrganization } from "../src/db/contacts";
import { deleteCard, getCardRow, setCardStatus } from "../src/db/deals";
import { listNotes } from "../src/db/notes";
import { createPipeline, listStages } from "../src/db/pipelines";
import { radarResumo, syncRadar, type RadarOportunidade, type RadarSyncConfig } from "../src/db/radar";
import { one } from "../src/db/sql";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

const ATIVADO = "2026-11-01T00:00:00.000Z";
const FUTURO = new Date(Date.now() + 5 * 86_400_000).toISOString();

const op = (over: Partial<RadarOportunidade> = {}): RadarOportunidade => ({
  id: 401,
  pedido: "2026230001",
  escola: "EE DR ANTONIO BATISTA DO NASCIMENTO",
  municipio: "Juiz de Fora",
  grupo: "Serviços Operacionais Contínuos",
  link: "https://caixaescolar.educacao.mg.gov.br/compras/orcamentos?budgetOrder=2026230001&page=1&limit=10&sortBy=:",
  emailEscola: "escola.248479@educacao.mg.gov.br",
  cnpjEscola: "",
  censo: { inep: "31248479", nome: "EE DR ANTONIO", turmas: 22, endereco: "R DAS FLORES, 10, CENTRO - Juiz de Fora/MG, CEP 36010-000", telefone: "(32) 33351195" },
  termos: ["grade horária"],
  iniciativa: "",
  itens: [{ descricao: "Software de grade horária escolar", tipo: "Software", quantidade: "1.00", unidade: "Unidade", garantia: "Suporte técnico por 12 meses" }],
  valorEstimado: 1,
  prazoEnvio: FUTURO,
  entrega: FUTURO,
  encontradoEm: "2026-11-20T10:00:00",
  situacao: "nova",
  arquivado: false,
  foraDaListagem: false,
  statusPortal: null,
  meuValor: null,
  apuracao: null,
  ...over,
});

async function setup(over: Partial<RadarSyncConfig> = {}) {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pid = createPipeline(db, ctx, {
    name: "PowerCubus",
    type: "comercial",
    stages: [{ name: "Prospect" }, { name: "Licitação" }, { name: "Proposta" }, { name: "Ganhos MG" }],
  });
  const st = Object.fromEntries(listStages(db, pid).map((s) => [s.name, s.id]));
  const cfg: RadarSyncConfig = {
    pipelineId: pid,
    stageEntrada: st["Licitação"],
    stageEnviada: st["Proposta"],
    stageGanha: st["Ganhos MG"],
    termos: [],
    inicio: "abertas",
    ativadoEm: ATIVADO,
    ...over,
  };
  const dealOf = (id: number) =>
    one<{ local_id: string }>(db, "SELECT local_id FROM external_ref WHERE provider = 'radar' AND entity_type = 'deal' AND external_id = ? AND deleted_at IS NULL", String(id))?.local_id;
  const fSgd = createCustomField(db, ctx, { entity: "deal", name: "Processo SGD", fieldType: "text" });
  const fTur = createCustomField(db, ctx, { entity: "deal", name: "Qtd Turmas", fieldType: "number" });
  const tagMG = createTag(db, ctx, { entity: "deal", name: "MG" });
  return { db, ctx, pid, st, cfg, dealOf, fSgd, fTur, tagMG };
}

describe("Radar Caixa Escolar MG", () => {
  it("cria o cartão na etapa de entrada com a escola como organização; repetir não duplica", async () => {
    const { db, ctx, st, cfg, dealOf } = await setup();
    const r = syncRadar(db, ctx, cfg, [op()]);
    expect(r).toMatchObject({ created: 1, updated: 0, errors: [] });
    const card = getCardRow(db, dealOf(401)!)!;
    expect(card).toMatchObject({ title: "EE DR ANTONIO BATISTA DO NASCIMENTO — Pedido 2026230001", stage_id: st["Licitação"], value_cents: 0, status: "open", origin: "Radar Caixa Escolar MG" });
    expect(card.expected_close_at).toBe(FUTURO);
    const [tarefa] = listActivities(db, { dealId: card.id });
    expect(tarefa).toMatchObject({ title: "Enviar proposta no portal — pedido 2026230001", due_at: FUTURO, done: 0 });
    expect(card.description).toContain("Turmas (Censo): 22 · INEP: 31248479");
    expect(card.description).toContain("Abrir no portal: https://caixaescolar");
    const org = getOrganization(db, card.organization_id!)!;
    expect(org).toMatchObject({ name: "EE DR ANTONIO BATISTA DO NASCIMENTO", city: "Juiz de Fora", email: "escola.248479@educacao.mg.gov.br" });
    expect(syncRadar(db, ctx, cfg, [op()])).toMatchObject({ created: 0, updated: 0 });
    expect(radarResumo(db)).toEqual({ cartoes: 1, abertos: 1 });
  });

  it("a mesma escola em dois orçamentos fica numa organização só", async () => {
    const { db, ctx, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op(), op({ id: 402, pedido: "2026230002" })]);
    expect(getCardRow(db, dealOf(401)!)!.organization_id).toBe(getCardRow(db, dealOf(402)!)!.organization_id);
  });

  it("proposta enviada move para Proposta com o valor; aprovada vira Ganho em Ganhos MG; nunca volta", async () => {
    const { db, ctx, st, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op()]);
    const enviada = syncRadar(db, ctx, cfg, [op({ statusPortal: "ENVI", foraDaListagem: true, meuValor: 887 })]);
    expect(enviada.items.map((i) => i.kind)).toEqual(["sent"]);
    let card = getCardRow(db, dealOf(401)!)!;
    expect(card).toMatchObject({ stage_id: st["Proposta"], value_cents: 88700, status: "open" });
    expect(listActivities(db, { dealId: card.id })[0]).toMatchObject({ done: 1 }); // tarefa do prazo concluída
    const mapa = {
      total: 2, posicao: 1, meuValor: 887, vencedor: "MINHA EMPRESA", valorVencedor: 887, venci: true,
      participantes: [
        { nome: "MINHA EMPRESA", valor: 887, posicao: 1, vencedor: true, eu: true },
        { nome: "CONCORRENTE X", valor: 950, posicao: 2, vencedor: false, eu: false },
      ],
    };
    syncRadar(db, ctx, cfg, [op({ statusPortal: "APRO", foraDaListagem: true, meuValor: 887, apuracao: mapa })]);
    card = getCardRow(db, dealOf(401)!)!;
    expect(card).toMatchObject({ stage_id: st["Ganhos MG"], status: "won" });
    const notas = listNotes(db, "deal", card.id).filter((n) => n.body.startsWith("Resultado no portal"));
    expect(notas).toHaveLength(1);
    expect(notas[0]!.body).toContain("você venceu");
    // De novo (ou um status "anterior" vindo atrasado): nada muda, nota não repete.
    expect(syncRadar(db, ctx, cfg, [op({ statusPortal: "ENVI", foraDaListagem: true, meuValor: 887, apuracao: mapa })])).toMatchObject({ updated: 0 });
    expect(getCardRow(db, card.id)).toMatchObject({ stage_id: st["Ganhos MG"], status: "won" });
    expect(listNotes(db, "deal", card.id)).toHaveLength(4); // 3 do orçamento + mapa, sem repetir
  });

  it("recusada e cancelada ficam Perdido com o motivo", async () => {
    const { db, ctx, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op(), op({ id: 402, pedido: "2026230002" })]);
    syncRadar(db, ctx, cfg, [
      op({ statusPortal: "RECU", foraDaListagem: true, apuracao: { total: 2, posicao: 2, meuValor: 900, vencedor: "CONCORRENTE X", valorVencedor: 850, venci: false, participantes: [] } }),
      op({ id: 402, pedido: "2026230002", statusPortal: "CANC", foraDaListagem: true, motivoCancelamento: "Escola desistiu da compra" }),
    ]);
    expect(getCardRow(db, dealOf(401)!)).toMatchObject({ status: "lost", loss_note: expect.stringContaining("vencedor CONCORRENTE X") });
    expect(getCardRow(db, dealOf(402)!)).toMatchObject({ status: "lost", loss_note: "Cancelado no portal: Escola desistiu da compra." });
  });

  it("cartão fechado à mão não é alterado; cartão excluído não volta", async () => {
    const { db, ctx, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op(), op({ id: 402, pedido: "2026230002" })]);
    setCardStatus(db, ctx, dealOf(401)!, { status: "lost", lossNote: "Sem interesse" });
    deleteCard(db, ctx, dealOf(402)!);
    const r = syncRadar(db, ctx, cfg, [op({ statusPortal: "APRO", foraDaListagem: true }), op({ id: 402, pedido: "2026230002" })]);
    expect(r.created).toBe(0);
    expect(getCardRow(db, dealOf(401)!)).toMatchObject({ status: "lost", loss_note: "Sem interesse" });
  });

  it("filtros: palavras-chave, descartados, arquivados sem status e o ponto de partida", async () => {
    const antigo = { encontradoEm: "2026-10-01T10:00:00" };
    const lista = [
      op({ id: 1, termos: ["certificado"] }), // fora das palavras-chave escolhidas
      op({ id: 2, situacao: "descartada" }),
      op({ id: 3, arquivado: true }),
      op({ id: 4, ...antigo }), // antigo, ainda no prazo
      op({ id: 5, ...antigo, foraDaListagem: true, statusPortal: "RECU", situacao: "tratada" }), // antigo, encerrado
      op({ id: 6, ...antigo, foraDaListagem: true, statusPortal: "ENVI", situacao: "tratada" }), // antigo, aguardando resultado
      op({ id: 7 }), // novo
    ];
    const ids = async (inicio: RadarSyncConfig["inicio"]) => {
      const { db, ctx, cfg, dealOf } = await setup({ inicio, termos: ["Grade Horaria"] });
      syncRadar(db, ctx, cfg, lista);
      return lista.map((o) => o.id).filter((id) => dealOf(id));
    };
    expect(await ids("novas")).toEqual([7]);
    expect(await ids("abertas")).toEqual([4, 6, 7]);
    expect(await ids("historico")).toEqual([4, 5, 6, 7]);
  });

  it("histórico: encerrado entra já fechado; funil inexistente dá erro claro", async () => {
    const { db, ctx, cfg, dealOf } = await setup({ inicio: "historico" });
    syncRadar(db, ctx, cfg, [op({ statusPortal: "APRO", foraDaListagem: true, meuValor: 500 })]);
    expect(getCardRow(db, dealOf(401)!)).toMatchObject({ status: "won", value_cents: 50000 });
    expect(() => syncRadar(db, ctx, { ...cfg, pipelineId: "nao-existe" }, [op()])).toThrow(/funil/);
  });

  it("notas do processo, garantia e contato; Processo SGD, Qtd Turmas e etiquetas MG e Pública", async () => {
    const { db, ctx, cfg, dealOf, fSgd, fTur, tagMG } = await setup();
    syncRadar(db, ctx, cfg, [op()]);
    const id = dealOf(401)!;
    const notas = listNotes(db, "deal", id).map((n) => n.body);
    expect(notas).toHaveLength(3);
    expect(notas.find((b) => b.startsWith("Descrição do processo"))).toContain("Software de grade horária escolar");
    expect(notas.find((b) => b.startsWith("Garantia exigida"))).toContain("Suporte técnico por 12 meses");
    const contato = notas.find((b) => b.startsWith("Contato e prazos"))!;
    expect(contato).toContain("E-mail da escola: escola.248479@educacao.mg.gov.br");
    expect(contato).toMatch(/Envio da proposta: \d{2}\/\d{2}\/\d{4}/);
    expect(contato).toMatch(/Entrega: \d{2}\/\d{2}\/\d{4}/);
    expect(getCustomValues(db, id)).toMatchObject({ [fSgd]: "2026230001", [fTur]: 22 });
    const tags = getEntityTags(db, id);
    expect(tags.map((t) => t.name).sort()).toEqual(["MG", "Pública"]);
    expect(tags.find((t) => t.name === "MG")!.id).toBe(tagMG); // usa a etiqueta que já existe
    syncRadar(db, ctx, cfg, [op()]);
    expect(listNotes(db, "deal", id)).toHaveLength(3); // não repete
  });

  it("cartões importados antes recebem notas, campos e etiquetas uma vez, sem apagar o que o usuário preencheu", async () => {
    const { db, ctx, cfg, dealOf, fSgd, fTur } = await setup();
    syncRadar(db, ctx, cfg, [op()]);
    const id = dealOf(401)!;
    // Simula um cartão da versão anterior: sem o marcador x, sem notas, campos e etiquetas.
    const r = one<{ id: string; source_updated_at: string }>(db, "SELECT id, source_updated_at FROM external_ref WHERE provider = 'radar' AND entity_type = 'deal'")!;
    const { x: _x, ...antes } = JSON.parse(r.source_updated_at) as Record<string, unknown>;
    updateRow(db, ctx, "external_ref", r.id, { source_updated_at: JSON.stringify(antes) });
    db.exec("UPDATE note SET deleted_at = '2026-01-01' ; UPDATE entity_tag SET deleted_at = '2026-01-01'; UPDATE custom_field_value SET deleted_at = '2026-01-01'");
    setCustomValues(db, ctx, "deal", id, { [fTur]: 30 });
    expect(syncRadar(db, ctx, cfg, [op()])).toMatchObject({ updated: 1 });
    expect(listNotes(db, "deal", id)).toHaveLength(3);
    expect(getCustomValues(db, id)).toMatchObject({ [fSgd]: "2026230001", [fTur]: 30 });
    expect(getEntityTags(db, id)).toHaveLength(2);
    expect(syncRadar(db, ctx, cfg, [op()])).toMatchObject({ updated: 0 });
  });

  it("enviada → recusada gera nota do resultado; o mapa lido depois vem numa nota nova, uma vez", async () => {
    const { db, ctx, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op({ statusPortal: "ENVI", foraDaListagem: true, meuValor: 945 })]);
    const id = dealOf(401)!;
    const resultados = () => listNotes(db, "deal", id).map((n) => n.body.replace(/ /g, " ")).filter((b) => b.startsWith("Resultado no portal"));
    expect(resultados()).toHaveLength(0);
    syncRadar(db, ctx, cfg, [op({ statusPortal: "RECU", foraDaListagem: true, meuValor: 945 })]);
    expect(resultados()).toHaveLength(1);
    expect(resultados()[0]).toContain("RECUSADA");
    expect(resultados()[0]).toContain("ainda não foi lido");
    const mapa = {
      total: 3, posicao: 2, meuValor: 945, vencedor: "TEKIE", valorVencedor: 900, venci: false,
      participantes: [
        { nome: "TEKIE", valor: 900, posicao: 1, vencedor: true, eu: false },
        { nome: "CLAUDIA TECNOLOGIA", valor: 945, posicao: 2, vencedor: false, eu: true },
        { nome: "VIP TECNOLOGIA", valor: 1523.2, posicao: 3, vencedor: false, eu: false },
      ],
    };
    syncRadar(db, ctx, cfg, [op({ statusPortal: "RECU", foraDaListagem: true, meuValor: 945, apuracao: mapa })]);
    expect(resultados()).toHaveLength(2);
    const ultima = resultados().find((b) => b.includes("Mapa de apuração"))!;
    expect(ultima).toContain("Sua posição: 2º de 3");
    expect(ultima).toContain("1º TEKIE · vencedor — R$ 900,00 (-4,8% do seu)");
    expect(ultima).toContain("2º CLAUDIA TECNOLOGIA (você)");
    syncRadar(db, ctx, cfg, [op({ statusPortal: "RECU", foraDaListagem: true, meuValor: 945, apuracao: mapa })]);
    expect(resultados()).toHaveLength(2);
  });

  it("aprovada com o mapa já lido: uma nota só, com o resumo", async () => {
    const { db, ctx, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op({ statusPortal: "ENVI", foraDaListagem: true, meuValor: 945 })]);
    const mapa = { total: 2, posicao: 1, meuValor: 945, vencedor: "CLAUDIA TECNOLOGIA", valorVencedor: 945, venci: true, participantes: [
      { nome: "CLAUDIA TECNOLOGIA", valor: 945, posicao: 1, vencedor: true, eu: true },
      { nome: "TEKIE", valor: 1129.04, posicao: 2, vencedor: false, eu: false },
    ] };
    syncRadar(db, ctx, cfg, [op({ statusPortal: "APRO", foraDaListagem: true, meuValor: 945, apuracao: mapa })]);
    const res = listNotes(db, "deal", dealOf(401)!).map((n) => n.body.replace(/ /g, " ")).filter((b) => b.startsWith("Resultado no portal"));
    expect(res).toHaveLength(1);
    expect(res[0]).toContain("APROVADA — você venceu");
    expect(res[0]).toContain("2º TEKIE — R$ 1.129,04 (+19,5% do seu)");
  });
});
