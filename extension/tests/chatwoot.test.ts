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

describe("Chatwoot: vencimento do boleto", () => {
  it("sem o campo preenchido, vem do vencimento da última cobrança do cartão", async () => {
    const { db, ctx, power, card } = await setup();
    const { saveInterCharge } = await import("../src/db/charges");
    cw.ensureChatwootFields(db, ctx, [power]);
    saveInterCharge(db, ctx, card, { env: "sandbox", seuNumero: "C1", codigoSolicitacao: "k1", situacao: "A_RECEBER", items: [{ description: "Licença", quantity: 1, priceCents: 49500 }], description: "B", dueDate: "2026-11-20" });
    const c = cw.chatwootContext(db, card);
    expect(c.data.vencimento_boleto).toBe("20/11/2026");
    expect(c.source.vencimento_boleto).toBe("vencimento da última cobrança do cartão");
    updateCard(db, ctx, card, { customValues: { [c.fields.vencimento_boleto!.id]: "2026-11-25" } });
    expect(cw.chatwootContext(db, card).data.vencimento_boleto).toBe("25/11/2026");
  });
});

describe("Chatwoot: dados da nota", () => {
  it("cria os 7 campos só no funil escolhido, uma vez", async () => {
    const { db, ctx, power, outro } = await setup();
    expect(cw.ensureChatwootFields(db, ctx, [power]).created).toEqual(["Qtd de turmas", "Plano", "Vencimento do boleto", "Fim da vigência", "Usuário Powercubus", "E-mail do usuário PowerCubus", "E-mail financeiro"]);
    expect(cw.ensureChatwootFields(db, ctx, [power]).created).toEqual([]);
    expect(listCustomFields(db, "deal", { pipelineId: power }).map((f) => f.placeholder_key)).toEqual(
      expect.arrayContaining(["qtd_turmas", "plano", "vencimento_boleto", "fim_vigencia", "usuario_powercubus", "email_usuario_powercubus", "email_financeiro"]),
    );
    expect(listCustomFields(db, "deal", { pipelineId: outro })).toEqual([]);
  });

  it("pagador dá os dados fiscais; escola principal dá o nome; campos do cartão completam", async () => {
    const { db, ctx, power, card, caixa } = await setup();
    let c = cw.chatwootContext(db, card);
    expect(c.missingFields).toHaveLength(7);
    expect(c.data).toMatchObject({ razao_social: "EE Doutor João Pinheiro", cnpj: "18.965.335/0001-00", usuario: "escola.190900@educacao.mg.gov.br" });

    cw.ensureChatwootFields(db, ctx, [power]);
    addCardOrganization(db, ctx, card, caixa, "pagador");
    const f = cw.chatwootContext(db, card).fields;
    updateCard(db, ctx, card, { customValues: { [f.qtd_turmas!.id]: 10, [f.plano!.id]: "Pro", [f.vencimento_boleto!.id]: "2026-11-20", [f.fim_vigencia!.id]: "2027-12-31", [f.email_financeiro!.id]: "financeiro@escola.com.br" } });
    c = cw.chatwootContext(db, card);
    expect(c.missingFields).toEqual([]);
    expect(c.data).toEqual({
      email_cliente: "escola.190900@educacao.mg.gov.br",
      nome_responsavel: "Rozi Souza",
      usuario: "escola.190900@educacao.mg.gov.br",
      email_usuario: "escola.190900@educacao.mg.gov.br",
      qtd_turmas: "10",
      plano: "Pro",
      vencimento_boleto: "20/11/2026",
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
    expect(cw.chatwootNote(c.data)).toContain(
      "**Solicito ativação de conta**\n\nUsuário: escola.190900@educacao.mg.gov.br\nEmail usuário PowerCubus: escola.190900@educacao.mg.gov.br\nQtd de turmas: 10\nPlano: Pro\nData de Vencimento do Boleto: 20/11/2026\nFim da vigência: 31/12/2027\nValor: R$ 495,00",
    );
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
    // Sem vencimento do boleto: só a atividade de acompanhamento.
    expect(r.paymentActivityId).toBeNull();
  });

  it("vencimento do boleto informado: atividade para conferir o pagamento no dia seguinte", async () => {
    const { db, ctx, card } = await setup();
    const data = { ...cw.chatwootContext(db, card).data, vencimento_boleto: "30/11/2026", valor: "R$ 595,00", nome_escola: "EE Doutor João Pinheiro", razao_social: "CAIXA ESCOLAR" };
    const r = cw.recordChatwootTicket(db, ctx, card, { conversationId: 2400, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2400", data }, new Date("2026-11-19T15:00:00"));
    const act = listActivities(db, { dealId: card }).find((a) => a.id === r.paymentActivityId)!;
    expect(act.title).toBe("Conferir pagamento do boleto");
    const due = new Date(act.due_at);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours()]).toEqual([2026, 12, 1, 9]);
    expect(act.description).toContain("Boleto com vencimento em 30/11/2026 (R$ 595,00): confirme se o cliente pagou.");
    expect(act.description).toContain("conversations/2400");
    expect(cw.parseBrDate("31/02/2026")).toBeNull();
    const bad = cw.recordChatwootTicket(db, ctx, card, { conversationId: 2401, link: "https://suporte.powercubus.com.br/app/accounts/1/conversations/2401", data: { ...data, vencimento_boleto: "31/02/2026" } });
    expect(bad.paymentActivityId).toBeNull();
  });
});

describe("rotina: conferir pagamento dos tickets já abertos", () => {
  it("cria um dia após o vencimento (nota do ticket ou campo), não repete, pula pago/cancelado/sem vencimento", async () => {
    const { db, ctx, power, card, escola } = await setup();
    const { saveInterCharge, applyInterSituacao } = await import("../src/db/charges");
    const link = (n: number) => `https://suporte.powercubus.com.br/app/accounts/1/conversations/${n}`;
    const base = cw.chatwootContext(db, card).data;
    // 1) Ticket com vencimento na nota (como os abertos pela 0.2.140+), sem atividade ainda.
    cw.recordChatwootTicket(db, ctx, card, { conversationId: 10, link: link(10), data: { ...base, vencimento_boleto: "" } });
    db.run("UPDATE note SET body = body || ? WHERE entity_type = 'deal' AND entity_id = ?", ["\nData de Vencimento do Boleto: 20/11/2026", card]);
    // 2) Sem vencimento em lugar nenhum.
    const c2 = createCard(db, ctx, { pipelineId: power, title: "Sem vencimento", organizationId: escola });
    cw.recordChatwootTicket(db, ctx, c2, { conversationId: 11, link: link(11), data: base });
    // 3) Cobrança já paga.
    const c3 = createCard(db, ctx, { pipelineId: power, title: "Já pago", organizationId: escola });
    const ch = saveInterCharge(db, ctx, c3, { env: "sandbox", seuNumero: "C3", codigoSolicitacao: "k3", situacao: "A_RECEBER", items: [{ description: "x", quantity: 1, priceCents: 1000 }], description: "B", dueDate: "2026-11-25" });
    applyInterSituacao(db, ctx, ch, { situacao: "RECEBIDO" });
    cw.recordChatwootTicket(db, ctx, c3, { conversationId: 12, link: link(12), data: base });
    // 4) Ticket cancelado: fora da rotina.
    const c4 = createCard(db, ctx, { pipelineId: power, title: "Cancelado", organizationId: escola });
    cw.recordChatwootTicket(db, ctx, c4, { conversationId: 13, link: link(13), data: { ...base, vencimento_boleto: "20/11/2026" } });
    db.run("UPDATE activity SET deleted_at = 'x' WHERE deal_id = ? AND title = ?", [c4, cw.PAYMENT_CHECK_TITLE]);
    cw.recordChatwootCancel(db, ctx, c4, { conversationId: 13, note: "Cliente desistiu" });

    const plan = cw.backfillPaymentChecks(db, ctx, { dryRun: true });
    expect(plan.map((p) => [p.cardTitle, p.status, p.checkDate])).toEqual([
      ["Licenças 2027", "criar", "2026-11-21"],
      ["Sem vencimento", "sem_vencimento", null],
      ["Já pago", "pago", null],
    ]);
    expect(listActivities(db, { dealId: card }).filter((a) => a.title === cw.PAYMENT_CHECK_TITLE)).toHaveLength(0);

    cw.backfillPaymentChecks(db, ctx);
    const acts = listActivities(db, { dealId: card }).filter((a) => a.title === cw.PAYMENT_CHECK_TITLE);
    expect(acts).toHaveLength(1);
    expect(new Date(acts[0]!.due_at).getDate()).toBe(21);
    expect(acts[0]!.description).toContain("conversations/10");
    // Segunda vez: não repete.
    expect(cw.backfillPaymentChecks(db, ctx, { dryRun: true })[0]!.status).toBe("ja_existe");
  });
});
