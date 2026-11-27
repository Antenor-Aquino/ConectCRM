// Radar Caixa Escolar MG (spec 25): orçamentos viram cartões, sem duplicar, e só avançam até o resultado.
import { describe, expect, it } from "vitest";
import { listActivities } from "../src/db/activities";
import { createCustomField, getCustomValues, setCustomValues } from "../src/db/customFields";
import { updateRow } from "../src/db/repo";
import { createTag, getEntityTags } from "../src/db/tags";
import { getOrganization } from "../src/db/contacts";
import { createCard, deleteCard, getCardRow, setCardStatus } from "../src/db/deals";
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

  it("proposta enviada move para Proposta com o valor; aprovada vai para Ganhos MG como Pendente; nunca volta", async () => {
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
    expect(card).toMatchObject({ stage_id: st["Ganhos MG"], status: "pending", closed_at: null });
    const notas = listNotes(db, "deal", card.id).filter((n) => n.body.startsWith("Resultado no portal"));
    expect(notas).toHaveLength(1);
    expect(notas[0]!.body).toContain("você venceu");
    // De novo (ou um status "anterior" vindo atrasado): nada muda, nota não repete.
    expect(syncRadar(db, ctx, cfg, [op({ statusPortal: "ENVI", foraDaListagem: true, meuValor: 887, apuracao: mapa })])).toMatchObject({ updated: 0 });
    expect(getCardRow(db, card.id)).toMatchObject({ stage_id: st["Ganhos MG"], status: "pending" });
    expect(listNotes(db, "deal", card.id)).toHaveLength(4); // 3 do orçamento + mapa, sem repetir
  });

  it("recusada e cancelada ficam Pendente, com o motivo na nota do resultado", async () => {
    const { db, ctx, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op(), op({ id: 402, pedido: "2026230002" })]);
    syncRadar(db, ctx, cfg, [
      op({ statusPortal: "RECU", foraDaListagem: true, apuracao: { total: 2, posicao: 2, meuValor: 900, vencedor: "CONCORRENTE X", valorVencedor: 850, venci: false, participantes: [] } }),
      op({ id: 402, pedido: "2026230002", statusPortal: "CANC", foraDaListagem: true, motivoCancelamento: "Escola desistiu da compra" }),
    ]);
    expect(getCardRow(db, dealOf(401)!)).toMatchObject({ status: "pending", loss_note: null });
    expect(getCardRow(db, dealOf(402)!)).toMatchObject({ status: "pending" });
    expect(listNotes(db, "deal", dealOf(401)!).some((n) => n.body.includes("RECUSADA"))).toBe(true);
    expect(listNotes(db, "deal", dealOf(402)!).some((n) => n.body.includes("Motivo: Escola desistiu da compra"))).toBe(true);
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

  it("histórico: encerrado entra já Pendente; funil inexistente dá erro claro", async () => {
    const { db, ctx, cfg, dealOf } = await setup({ inicio: "historico" });
    syncRadar(db, ctx, cfg, [op({ statusPortal: "APRO", foraDaListagem: true, meuValor: 500 })]);
    expect(getCardRow(db, dealOf(401)!)).toMatchObject({ status: "pending", value_cents: 50000 });
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

  it("cartões que o Radar fechou antes da 0.2.160 voltam para Pendente; fechado à mão fica", async () => {
    const { db, ctx, cfg, dealOf } = await setup();
    syncRadar(db, ctx, cfg, [op({ id: 1 }), op({ id: 2 }), op({ id: 3 })]);
    // Simula a versão anterior: marcador sem "p", estado de resultado e o cartão fechado.
    const antigo = (id: number, e: string) => {
      const r = one<{ id: string; source_updated_at: string }>(db, "SELECT id, source_updated_at FROM external_ref WHERE provider = 'radar' AND entity_type = 'deal' AND external_id = ?", String(id))!;
      const { p: _p, ...m } = JSON.parse(r.source_updated_at) as Record<string, unknown>;
      updateRow(db, ctx, "external_ref", r.id, { source_updated_at: JSON.stringify({ ...m, e }) });
    };
    setCardStatus(db, ctx, dealOf(1)!, { status: "won" }); // pelo Radar: mesmo instante que o vínculo
    antigo(1, "ganha");
    setCardStatus(db, ctx, dealOf(2)!, { status: "lost", lossNote: "Recusada no portal; vencedor X (R$ 900,00)." });
    antigo(2, "perdida");
    setCardStatus(db, ctx, dealOf(3)!, { status: "won" }); // à mão, bem antes do resultado chegar
    db.exec(`UPDATE change_log SET at = '2026-01-01T00:00:00.000Z' WHERE table_name = 'deal' AND row_id = '${dealOf(3)!}' AND changes LIKE '%"status"%'`);
    antigo(3, "ganha");
    const r = syncRadar(db, ctx, cfg, [op({ id: 1 }), op({ id: 2 }), op({ id: 3 })]);
    expect(r.convertidos).toBe(2);
    expect(getCardRow(db, dealOf(1)!)).toMatchObject({ status: "pending", closed_at: null });
    expect(getCardRow(db, dealOf(2)!)).toMatchObject({ status: "pending", loss_note: null });
    expect(getCardRow(db, dealOf(3)!)!.status).toBe("won");
    // Uma vez só: se o usuário decidir ganho, a leitura seguinte não volta para Pendente.
    setCardStatus(db, ctx, dealOf(1)!, { status: "won" });
    expect(syncRadar(db, ctx, cfg, [op({ id: 1 })]).convertidos).toBe(0);
    expect(getCardRow(db, dealOf(1)!)!.status).toBe("won");
  });

  it("todo o histórico: cartão de nome parecido pergunta antes; prosseguir, não criar ou usar o existente", async () => {
    const { db, ctx, pid, cfg, dealOf } = await setup({ inicio: "historico" });
    const meu = createCard(db, ctx, { pipelineId: pid, title: "EE Dr Antonio Batista do Nascimento - PowerCubus" });
    const lista = [op({ id: 1 }), op({ id: 2, pedido: "2026230002" }), op({ id: 3, pedido: "2026230003" }), op({ id: 4, escola: "EE SAO GABRIEL", pedido: "2026230004" })];
    const r = syncRadar(db, ctx, cfg, lista);
    expect(r.parecidos.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(r.parecidos[0]!.cartoes[0]).toMatchObject({ id: meu, titulo: "EE Dr Antonio Batista do Nascimento - PowerCubus" });
    expect(dealOf(4)).toBeTruthy(); // sem parecido: cria direto
    expect(dealOf(1)).toBeUndefined();
    const r2 = syncRadar(db, ctx, { ...cfg, decisoes: { "1": "criar", "2": "ignorar", "3": `usar:${meu}` } }, lista);
    expect(r2.parecidos).toEqual([]);
    expect(dealOf(1)).toBeTruthy();
    expect(dealOf(1)).not.toBe(meu);
    expect(dealOf(2)).toBeUndefined();
    expect(dealOf(3)).toBe(meu);
    expect(listNotes(db, "deal", meu).some((n) => n.body.startsWith("Contato e prazos (pedido 2026230003)"))).toBe(true);
    // Fora de "Todo o histórico" não pergunta.
    const s2 = await setup({ inicio: "abertas" });
    createCard(s2.db, s2.ctx, { pipelineId: s2.pid, title: "EE Dr Antonio Batista do Nascimento" });
    expect(syncRadar(s2.db, s2.ctx, s2.cfg, [op()]).parecidos).toEqual([]);
    expect(s2.dealOf(401)).toBeTruthy();
  });
});
