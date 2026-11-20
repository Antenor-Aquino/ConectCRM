// Chatwoot (ativação Powercubus): dados da nota a partir do cartão, campos
// personalizados no funil, registro do ticket (nota + atividade).
import { describe, expect, it } from "vitest";
import { listActivities } from "../src/db/activities";
import { addCardOrganization } from "../src/db/cardOrganizations";
import * as cw from "../src/db/chatwoot";
import { createOrganization, createPerson } from "../src/db/contacts";
import { listCustomFields } from "../src/db/customFields";
import { createCard, updateCard } from "../src/db/deals";
import { listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const power = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const outro = createPipeline(db, ctx, { name: "Certificados", type: "comercial", stages: [{ name: "Prospect" }] });
  const escola = createOrganization(db, ctx, { name: "EE Doutor João Pinheiro", cnpj: "18965335000100", cep: "36730000", street: "Av. Presidente Carlos Luz", number: "141", district: "Centro", city: "Pirapetinga", state: "MG" } as Parameters<typeof createOrganization>[2]);
  const caixa = createOrganization(db, ctx, {
    name: "Caixa Escolar João Pinheiro",
    legalName: "CAIXA ESCOLAR DOUTOR JOAO PINHEIRO",
    cnpj: "19929587000146",
    cep: "38067230",
    street: "Rua A",
    number: "10",
    district: "Centro",
    city: "Uberaba",
    state: "MG",
  } as Parameters<typeof createOrganization>[2]);
  const rozi = createPerson(db, ctx, { name: "Rozi Souza", email: "escola.190900@educacao.mg.gov.br" });
  const card = createCard(db, ctx, { pipelineId: power, title: "Licenças 2027", organizationId: escola, personId: rozi, valueCents: 49500 });
  return { db, ctx, power, outro, escola, caixa, card };
}

describe("Chatwoot: dados da nota", () => {
  it("cria os 5 campos só no funil escolhido, uma vez", async () => {
    const { db, ctx, power, outro } = await setup();
    expect(cw.ensureChatwootFields(db, ctx, [power]).created).toEqual(["Qtd de turmas", "Plano", "Fim da vigência", "Usuário Powercubus", "E-mail financeiro"]);
    expect(cw.ensureChatwootFields(db, ctx, [power]).created).toEqual([]);
    expect(listCustomFields(db, "deal", { pipelineId: power }).map((f) => f.placeholder_key)).toEqual(
      expect.arrayContaining(["qtd_turmas", "plano", "fim_vigencia", "usuario_powercubus", "email_financeiro"]),
    );
    expect(listCustomFields(db, "deal", { pipelineId: outro })).toEqual([]);
  });

  it("pagador dá os dados fiscais; escola principal dá o nome; campos do cartão completam", async () => {
    const { db, ctx, power, card, caixa } = await setup();
    let c = cw.chatwootContext(db, card);
    expect(c.missingFields).toHaveLength(5);
    expect(c.data).toMatchObject({ razao_social: "EE Doutor João Pinheiro", cnpj: "18.965.335/0001-00", usuario: "escola.190900@educacao.mg.gov.br" });

    cw.ensureChatwootFields(db, ctx, [power]);
    addCardOrganization(db, ctx, card, caixa, "pagador");
    const f = cw.chatwootContext(db, card).fields;
    updateCard(db, ctx, card, { customValues: { [f.qtd_turmas!.id]: 10, [f.plano!.id]: "Pro", [f.fim_vigencia!.id]: "2027-12-31", [f.email_financeiro!.id]: "financeiro@escola.com.br" } });
    c = cw.chatwootContext(db, card);
    expect(c.missingFields).toEqual([]);
    expect(c.data).toEqual({
      email_cliente: "escola.190900@educacao.mg.gov.br",
      nome_responsavel: "Rozi Souza",
      usuario: "escola.190900@educacao.mg.gov.br",
      qtd_turmas: "10",
      plano: "Pro",
      fim_vigencia: "31/12/2027",
      valor: "R$ 495,00",
      razao_social: "CAIXA ESCOLAR DOUTOR JOAO PINHEIRO",
      nome_escola: "EE Doutor João Pinheiro",
      cnpj: "19.929.587/0001-46",
      cep: "38067-230",
      endereco: "Rua A, 10 - Centro - Uberaba/MG",
      email_financeiro: "financeiro@escola.com.br",
    });
    expect(c.source.razao_social).toBe("organização pagadora");
    expect(cw.chatwootMissing(c.data)).toEqual([]);
    expect(cw.chatwootMissing({ ...c.data, cnpj: " " })).toEqual(["cnpj"]);
    expect(cw.chatwootNote(c.data)).toContain("**Solicito ativação de conta**\n\nUsuário: escola.190900@educacao.mg.gov.br\nQtd de turmas: 10");
  });

  it("registra o ticket: nota com o link, atividade em 2 dias e aviso de repetição", async () => {
    const { db, ctx, card } = await setup();
    const data = cw.chatwootContext(db, card).data;
    const now = new Date("2026-11-19T15:00:00");
    const r = cw.recordChatwootTicket(db, ctx, card, { conversationId: 2316, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2316", data }, now);
    expect(cw.chatwootContext(db, card).tickets).toMatchObject([{ conversation_id: 2316, created_by_name: "Antenor" }]);
    const note = listNotes(db, "deal", card)[0]!.body;
    expect(note).toContain("Ticket de ativação aberto no Chatwoot (conversa 2316)");
    expect(note).toContain("https://suporte.powercubus.com.br/app/accounts/1/conversations/2316");
    expect(note).not.toContain("**");
    const act = listActivities(db, { dealId: card }).find((a) => a.id === r.activityId)!;
    expect(act.title).toBe("Acompanhar ativação no Chatwoot");
    expect(new Date(act.due_at).getDate()).toBe(21);
    expect(() => cw.recordChatwootTicket(db, ctx, card, { conversationId: 0, link: "x", data })).toThrow(/inválid/);
  });
});
