// Dados de exemplo do ambiente de Teste (baseados no mockup da tela inicial).
// Só roda num banco vazio do ambiente "demo"; nunca em Produção.
import { createActivity, setActivityDone } from "./activities";
import { createOrganization, createPerson } from "./contacts";
import { createCustomField, listCustomFields } from "./customFields";
import { contextLinks, listDocumentTypes, localDate, seedDocumentWithBytes } from "./documents";
import { createCard, createLossReason, moveCard, setCardStatus, setDealItems } from "./deals";
import { makeFacadeSvg, makePdf } from "../lib/demoFiles";
import { createPipeline, listStages } from "./pipelines";
import { createProduct } from "./products";
import type { DbContext } from "./repo";
import { many, withTransaction, type DatabaseSync } from "./sql";
import { createTag, setEntityTags } from "./tags";
import { createTeam, createUser } from "./users";

const day = 86400_000;
const at = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * day);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export function seedDemoData(db: DatabaseSync, workspaceId: string): void {
  withTransaction(db, () => {
    const sys: DbContext = { workspaceId, userId: null };
    const admin = createUser(db, sys, { name: "Administrador (teste)", email: "admin@exemplo.com.br", role: "admin" });
    const ctx: DbContext = { workspaceId, userId: admin };
    const gestor = createUser(db, ctx, { name: "Gustavo (gestor)", role: "gestor" });
    const ana = createUser(db, ctx, { name: "Ana Vendas", role: "vendedor" });
    const bruno = createUser(db, ctx, { name: "Bruno Vendas", role: "vendedor" });
    createTeam(db, ctx, { name: "Comercial", members: [{ userId: gestor, isLeader: true }, { userId: ana }, { userId: bruno }] });

    const quente = createTag(db, ctx, { entity: "deal", name: "Quente", color: "red" });
    createTag(db, ctx, { entity: "deal", name: "Indicação", color: "green" });
    createTag(db, ctx, { entity: "person", name: "Decisor", color: "purple" });
    const reasons = [createLossReason(db, ctx, "Preço"), createLossReason(db, ctx, "Escolheu concorrente"), createLossReason(db, ctx, "Sem orçamento")];
    const origem = createCustomField(db, ctx, {
      entity: "person",
      name: "Origem do Lead",
      fieldType: "select",
      options: [{ label: "Instagram" }, { label: "Indicação" }, { label: "Site" }],
    });
    createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text" });
    const licenca = createProduct(db, ctx, { code: "PC-ANUAL", name: "PowerCubus — licença anual", kind: "servico", priceCents: 480000, recurrence: "anual" });
    const implantacao = createProduct(db, ctx, { code: "PC-IMPL", name: "Implantação", kind: "servico", priceCents: 150000 });

    const orgs = {
      abmes: createOrganization(db, ctx, { name: "ABMES", segment: "Educação", city: "Brasília", state: "DF" }),
      anup: createOrganization(db, ctx, { name: "ANUP", segment: "Educação", city: "Brasília", state: "DF" }),
      motivo: createOrganization(db, ctx, { name: "Colégio Motivo", segment: "Educação", city: "Recife", state: "PE" }),
      puc: createOrganization(db, ctx, { name: "PUC-PR", segment: "Educação", city: "Curitiba", state: "PR" }),
      santaUrsula: createOrganization(db, ctx, { name: "Colégio Santa Úrsula", segment: "Educação", city: "Maceió", state: "AL" }),
      pentagono: createOrganization(db, ctx, { name: "Colégio Pentágono", segment: "Educação", city: "São Paulo", state: "SP" }),
    };
    const options = listCustomFields(db, "person").find((f) => f.id === origem)!.options;
    const opt = (label: string) => options.find((o) => o.label === label)!.id;
    const p = (name: string, org: string | null, phone: string, extra: Partial<Parameters<typeof createPerson>[2]> = {}) =>
      createPerson(db, ctx, { name, phone, organizationIds: org ? [org] : [], customValues: { [origem]: opt("Indicação") }, ...extra });
    const people = {
      dalliane: p("Dalliane", orgs.abmes, "61991110001"),
      anup: p("Contato ANUP", orgs.anup, "61991110002"),
      raquel: p("Raquel", orgs.anup, "61991110003"),
      rafael: p("Rafael Gonçalves Marreca", null, "11991110004"),
      daniel: p("Daniel Fratucello", orgs.motivo, "81991110005"),
      cris: p("Cris", orgs.motivo, "81991110006"),
      mieza: p("Mieza", null, "11991110007"),
      jean: p("Jean Carlos de Oliveira", null, "11991110008"),
      fabio: p("Fábio", orgs.santaUrsula, "82991110009"),
      mari: p("Mari", orgs.puc, "41991110010", { email: "mari@pucpr.exemplo.br" }),
      regina: p("Regina", null, "11991110011"),
      horario: p("Horário", orgs.pentagono, "11991110012"),
    };

    // Funil comercial do mockup
    const power = createPipeline(db, ctx, {
      name: "PowerCubus",
      type: "comercial",
      stages: [
        { name: "Prospect", color: "red", probability: 10 },
        { name: "Contato", color: "purple", probability: 30 },
        { name: "Reunião", color: "slate", probability: 50 },
        { name: "Pendência Pedagógica", color: "cyan", probability: 70 },
      ],
    });
    const [prospect, contato, reuniao] = listStages(db, power);
    const deal = (title: string, person: string, stage: string, owner: string, value = 0) => {
      const id = createCard(db, ctx, { pipelineId: power, title, personId: person, ownerId: owner, valueCents: value });
      if (stage !== prospect!.id) moveCard(db, ctx, id, { stageId: stage });
      return id;
    };
    const d1 = deal("Dalliane ABMES", people.dalliane, prospect!.id, ana, 480000);
    deal("ANUP", people.anup, prospect!.id, ana);
    deal("Raquel ANUP", people.raquel, prospect!.id, bruno);
    deal("Rafael Gonçalves Marreca", people.rafael, prospect!.id, bruno);
    deal("Daniel Fratucello", people.daniel, prospect!.id, ana);
    deal("Cris - Col Motivo", people.cris, prospect!.id, bruno);
    const d2 = deal("Mieza", people.mieza, contato!.id, ana);
    deal("Jean Carlos de Oliveira", people.jean, contato!.id, bruno);
    deal("Fábio Col Santa Ursula AL", people.fabio, contato!.id, ana);
    const d3 = deal("Mari DAC PUC-PR", people.mari, reuniao!.id, gestor);
    const lost = deal("Regina", people.regina, contato!.id, bruno);
    deal("Horário Col Pentágono", people.horario, contato!.id, ana);
    setDealItems(db, ctx, d3, [{ productId: licenca }, { productId: implantacao }]);
    setCardStatus(db, ctx, lost, { status: "lost", lossNote: "Sem orçamento este ano" });
    setEntityTags(db, ctx, "deal", d1, [quente]);

    // Abertos do mockup: há quanto tempo estão na etapa atual (2 a 40 dias),
    // para "negócios parados" e "dias na etapa" terem o que mostrar.
    many<{ id: string }>(db, "SELECT id FROM deal WHERE pipeline_id = ? AND status = 'open' ORDER BY rowid", power).forEach(({ id }, i) => {
      const entered = Date.now() - (2 + ((i * 11) % 39)) * day;
      db.run("UPDATE deal SET created_at = ?, stage_entered_at = ? WHERE id = ?", [new Date(entered - 3 * day).toISOString(), new Date(entered).toISOString(), id]);
      db.run("UPDATE deal_stage_history SET entered_at = ? WHERE deal_id = ? AND left_at IS NULL", [new Date(entered).toISOString(), id]);
      db.run("UPDATE deal_stage_history SET entered_at = ?, left_at = ? WHERE deal_id = ? AND left_at IS NOT NULL", [new Date(entered - 3 * day).toISOString(), new Date(entered).toISOString(), id]);
    });

    // Histórico dos últimos 6 meses (para os Relatórios): negócios ganhos e
    // perdidos com datas retroativas, etapas percorridas e itens vendidos.
    const stages = listStages(db, power);
    const owners = [ana, bruno, gestor];
    const contacts = Object.values(people);
    const titles = ["Renovação", "Licença anual", "Ampliação de turmas", "Projeto pedagógico", "Plano escola", "Pacote coordenação"];
    for (let i = 0; i < 18; i++) {
      const won = i % 3 !== 2;
      const depth = won ? stages.length - 1 : i % stages.length; // perdidos param em etapas diferentes
      const value = (6 + ((i * 7) % 11)) * 60000;
      const id = createCard(db, ctx, { pipelineId: power, title: `${titles[i % titles.length]} ${i + 1}`, personId: contacts[i % contacts.length], ownerId: owners[(i + Math.floor(i / 3)) % owners.length], valueCents: value });
      for (let s = 1; s <= depth; s++) moveCard(db, ctx, id, { stageId: stages[s]!.id });
      if (won) setDealItems(db, ctx, id, i % 2 ? [{ productId: licenca }] : [{ productId: licenca }, { productId: implantacao }]);
      setCardStatus(db, ctx, id, won ? { status: "won" } : { status: "lost", lossReasonId: reasons[Math.floor(i / 3) % reasons.length] });
      // Datas: criado entre 6 meses e 1 semana atrás; cada etapa leva de 2 a 9 dias.
      let t = Date.now() - (180 - i * 9) * day;
      db.run("UPDATE deal SET created_at = ? WHERE id = ?", [new Date(t).toISOString(), id]);
      const hist = many<{ id: string }>(db, "SELECT id FROM deal_stage_history WHERE deal_id = ? ORDER BY entered_at, rowid", id);
      hist.forEach((h, k) => {
        const len = (2 + ((i + k * 3) % 8)) * day;
        db.run("UPDATE deal_stage_history SET entered_at = ?, left_at = ? WHERE id = ?", [new Date(t).toISOString(), k < hist.length - 1 ? new Date(t + len).toISOString() : null, h.id]);
        if (k < hist.length - 1) t += len;
      });
      t += (1 + (i % 4)) * day;
      db.run("UPDATE deal SET stage_entered_at = ?, closed_at = ? WHERE id = ?", [new Date(t - day).toISOString(), new Date(Math.min(t, Date.now())).toISOString(), id]);
    }
    for (let i = 0; i < 24; i++) {
      const a = createActivity(db, ctx, { title: `Follow-up ${i + 1}`, dueAt: at(-3 - i * 7, 10), endAt: at(-1 - i * 7, 18), ownerId: owners[i % owners.length] });
      if (i % 5 !== 0) setActivityDone(db, ctx, a, true);
    }

    // Funis operacional e de projeto
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo ticket", color: "red" }, { name: "Em atendimento", color: "amber" }, { name: "Resolvido", color: "green" }] });
    createCard(db, ctx, { pipelineId: suporte, title: "Falha no acesso do cliente", description: "Usuário não consegue entrar no portal.", slaAt: at(1, 17), personId: people.mari, ownerId: gestor });
    const projeto = createPipeline(db, ctx, { name: "Implantação PUC-PR", type: "projeto", stages: [{ name: "A fazer" }, { name: "Em andamento", color: "blue" }, { name: "Concluído", color: "green" }] });
    createCard(db, ctx, { pipelineId: projeto, title: "Treinamento dos coordenadores", startAt: at(3, 9), dueAt: at(10, 18), organizationId: orgs.puc, ownerId: gestor });

    // Tarefas
    createActivity(db, ctx, { title: "Ligar para Dalliane", dealId: d1, dueAt: at(0, 10), ownerId: ana });
    createActivity(db, ctx, { title: "Enviar proposta", dealId: d2, dueAt: at(-3, 9), endAt: at(-1, 15), ownerId: ana });
    const apresentacao = createActivity(db, ctx, { title: "Preparar apresentação da PUC", dealId: d3, dueAt: at(-2, 9), endAt: at(4, 18), ownerId: gestor });
    createActivity(db, ctx, { title: "Revisar cadastro dos contatos", dueAt: at(-6, 9), ownerId: ana });
    createActivity(db, ctx, { title: "Reunião de apresentação", dealId: d3, dueAt: at(2, 14), durationMin: 60, ownerId: gestor });
    createActivity(db, ctx, { title: "Organizar agenda da semana", dueAt: at(1, 9), ownerId: admin });

    // Documentos (GED), com os vínculos que a tela de origem criaria.
    const types = listDocumentTypes(db);
    const typeId = (name: string) => types.find((t) => t.name === name)!.id;
    const inDays = (n: number) => localDate(new Date(Date.now() + n * day));
    const assinado = createTag(db, ctx, { entity: "document", name: "Assinado", color: "green" });
    const pdf = (title: string, lines: string[]) => ({ mime: "application/pdf", bytes: makePdf(title, lines), text: [title, ...lines].join(" ") });
    seedDocumentWithBytes(db, ctx, {
      name: "Proposta comercial PowerCubus - PUC-PR",
      typeId: typeId("Proposta"),
      docDate: inDays(-4),
      links: contextLinks(db, "deal", d3),
      filename: "proposta-powercubus-pucpr.pdf",
      ...pdf("Proposta comercial PowerCubus", ["Cliente: PUC-PR (Curitiba/PR)", "Licença anual: R$ 4.800,00", "Implantação: R$ 1.500,00", "Validade da proposta: 30 dias"]),
    });
    seedDocumentWithBytes(db, ctx, {
      name: "Comprovante de endereço - Mari",
      typeId: typeId("Comprovante de endereço"),
      docDate: inDays(-85),
      validUntil: inDays(5),
      links: contextLinks(db, "person", people.mari),
      filename: "conta-de-luz-mari.pdf",
      ...pdf("Fatura de energia elétrica", ["COPEL - Companhia Paranaense de Energia", "Titular: Mari", "Endereço: Rua Imaculada Conceição, 1155 - Curitiba/PR"]),
    });
    seedDocumentWithBytes(db, ctx, {
      name: "Contrato de licença - ABMES",
      typeId: typeId("Contrato"),
      docDate: inDays(-20),
      restricted: true,
      tagIds: [assinado],
      description: "Contrato anual com cláusula de reajuste pelo IPCA.",
      links: contextLinks(db, "deal", d1),
      filename: "contrato-abmes.pdf",
      ...pdf("Contrato de licença de uso", ["Contratante: ABMES - Brasília/DF", "Vigência: 12 meses", "Reajuste anual pelo IPCA"]),
    });
    seedDocumentWithBytes(db, ctx, {
      name: "Pauta da apresentação",
      typeId: typeId("Outros"),
      links: contextLinks(db, "activity", apresentacao),
      filename: "pauta-apresentacao.pdf",
      ...pdf("Pauta da apresentação - PUC-PR", ["1. Diagnóstico pedagógico", "2. Demonstração do PowerCubus", "3. Cronograma de implantação"]),
    });
    seedDocumentWithBytes(db, ctx, {
      name: "Fachada da PUC-PR",
      typeId: typeId("Foto/imagem"),
      links: [{ type: "organization", id: orgs.puc }],
      filename: "fachada-pucpr.svg",
      mime: "image/svg+xml",
      bytes: makeFacadeSvg("PUC-PR"),
    });
    seedDocumentWithBytes(db, ctx, {
      name: "Certificado de regularidade - Colégio Motivo",
      typeId: typeId("Certificado"),
      docDate: inDays(-375),
      validUntil: inDays(-10),
      links: [{ type: "organization", id: orgs.motivo }],
      filename: "certificado-motivo.pdf",
      ...pdf("Certificado de regularidade", ["Colégio Motivo - Recife/PE", "Situação: regular"]),
    });
  });
}
