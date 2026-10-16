// Dados de exemplo do ambiente de Teste (baseados no mockup da tela inicial).
// Só roda num banco vazio do ambiente "demo"; nunca em Produção.
import { createActivity } from "./activities";
import { createOrganization, createPerson } from "./contacts";
import { createCustomField, listCustomFields } from "./customFields";
import { createCard, createLossReason, moveCard, setCardStatus, setDealItems } from "./deals";
import { createPipeline, listStages } from "./pipelines";
import { createProduct } from "./products";
import type { DbContext } from "./repo";
import { withTransaction, type DatabaseSync } from "./sql";
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
    createLossReason(db, ctx, "Preço");
    createLossReason(db, ctx, "Escolheu concorrente");
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

    // Funis operacional e de projeto
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo ticket", color: "red" }, { name: "Em atendimento", color: "amber" }, { name: "Resolvido", color: "green" }] });
    createCard(db, ctx, { pipelineId: suporte, title: "Falha no acesso do cliente", description: "Usuário não consegue entrar no portal.", slaAt: at(1, 17), personId: people.mari, ownerId: gestor });
    const projeto = createPipeline(db, ctx, { name: "Implantação PUC-PR", type: "projeto", stages: [{ name: "A fazer" }, { name: "Em andamento", color: "blue" }, { name: "Concluído", color: "green" }] });
    createCard(db, ctx, { pipelineId: projeto, title: "Treinamento dos coordenadores", startAt: at(3, 9), dueAt: at(10, 18), organizationId: orgs.puc, ownerId: gestor });

    // Tarefas
    createActivity(db, ctx, { title: "Ligar para Dalliane", dealId: d1, dueAt: at(0, 10), ownerId: ana });
    createActivity(db, ctx, { title: "Enviar proposta", dealId: d2, dueAt: at(-1, 15), ownerId: ana });
    createActivity(db, ctx, { title: "Reunião de apresentação", dealId: d3, dueAt: at(2, 14), durationMin: 60, ownerId: gestor });
    createActivity(db, ctx, { title: "Organizar agenda da semana", dueAt: at(1, 9), ownerId: admin });
  });
}
