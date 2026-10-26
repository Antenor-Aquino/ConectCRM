// Integração com a Gestão Financeira, Fase 2 (spec 13): cliente/fornecedor do
// cartão, CPF do contato e a cópia local dos lançamentos.
import { describe, expect, it, vi } from "vitest";
import { cardCounts } from "../src/db/cardCounts";
import { createOrganization, createPerson, getPerson, updatePerson } from "../src/db/contacts";
import { createCard, updateCard } from "../src/db/deals";
import { cardCounterparty, cardFinance, replaceFinance, summarize } from "../src/db/finance";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import type { FinanceItem } from "../src/lib/finance/protocol";
import { isValidCpf } from "../src/lib/validate";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx } = await freshDb();
  const actx = { ...ctx, userId: createUser(db, ctx, { name: "Antenor", role: "admin" }) };
  const pl = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "Proposta" }] });
  const stage = db.exec(`SELECT id FROM stage WHERE pipeline_id = '${pl}'`)[0]!.values[0]![0] as string;
  const card = (title: string, extra: Record<string, unknown> = {}) => createCard(db, actx, { pipelineId: pl, stageId: stage, title, ...extra });
  return { db, actx, card };
}

const item = (p: Partial<FinanceItem> & Pick<FinanceItem, "id" | "ref" | "type" | "amountCents">): FinanceItem => ({
  code: null, status: "pending", description: "x", competenceDate: "2026-10-01", dueDate: "2026-10-10", paymentDate: null,
  category: null, subcategory: null, costCenter: null, costSubcenter: null, counterparty: null, wallet: "Empresa", account: null, creditCard: null,
  installmentNumber: null, installmentTotal: null, ...p,
});

describe("CPF do contato", () => {
  it("valida, guarda só dígitos e não repete", async () => {
    const { db, actx } = await setup();
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("11111111111")).toBe(false);
    const id = createPerson(db, actx, { name: "Maria", cpf: "529.982.247-25" });
    expect(getPerson(db, id)?.cpf).toBe("52998224725");
    expect(() => createPerson(db, actx, { name: "Outra", cpf: "52998224725" })).toThrow(/CPF já cadastrado em "Maria"/);
    expect(() => createPerson(db, actx, { name: "Errado", cpf: "123.456.789-00" })).toThrow(/CPF inválido/);
    updatePerson(db, actx, id, { cpf: "529.982.247-25" }); // o próprio não conta como repetido
    updatePerson(db, actx, id, { cpf: "" });
    expect(getPerson(db, id)?.cpf).toBeNull();
  });
});

describe("cliente/fornecedor do cartão", () => {
  it("organização; sem ela, o contato principal; sem nenhum, null", async () => {
    const { db, actx, card } = await setup();
    const org = createOrganization(db, actx, { name: "Caixa Escolar", cnpj: "19.489.640/0001-35", email: "escola@mg.gov.br" });
    const pessoa = createPerson(db, actx, { name: "Beatriz", cpf: "52998224725", phone: "31999998888" });
    const c1 = card("Com organização", { organizationId: org, personId: pessoa });
    expect(cardCounterparty(db, c1)).toMatchObject({ crmRef: `organization:${org}`, kind: "PJ", name: "Caixa Escolar", document: "19489640000135", email: "escola@mg.gov.br", phone: null });
    const c2 = card("Só contato", { personId: pessoa });
    expect(cardCounterparty(db, c2)).toMatchObject({ crmRef: `person:${pessoa}`, kind: "PF", name: "Beatriz", document: "52998224725", phone: "+5531999998888" });
    const c3 = card("Sem ninguém");
    expect(cardCounterparty(db, c3)).toBeNull();
    updateCard(db, actx, c3, { personId: pessoa });
    expect(cardCounterparty(db, c3)?.kind).toBe("PF");
  });
});

describe("cópia dos lançamentos", () => {
  it("substitui por cartão, guarda quando leu e resume receitas, despesas e resultado", async () => {
    const { db, actx, card } = await setup();
    const a = card("A");
    const b = card("B");
    expect(cardFinance(db, a)).toMatchObject({ entries: [], syncedAt: null });
    replaceFinance(db, actx, [a, b], [
      item({ id: "t1", ref: a, type: "income", amountCents: 100000, status: "paid", paymentDate: "2026-10-05" }),
      item({ id: "t2", ref: a, type: "income", amountCents: 50000, dueDate: "2000-01-01" }),
      item({ id: "t3", ref: a, type: "expense", amountCents: 30000, status: "paid", paymentDate: "2026-10-02" }),
      item({ id: "t4", ref: b, type: "expense", amountCents: 999 }),
      item({ id: "t5", ref: "outro", type: "expense", amountCents: 1 }),
    ], "production", "2026-10-20T10:00:00.000Z");
    const fa = cardFinance(db, a);
    expect(fa.entries.map((e) => e.id)).toEqual(["t2", "t1", "t3"]); // por vencimento
    expect(fa.syncedAt).toBe("2026-10-20T10:00:00.000Z");
    expect(fa.summary).toEqual({ incomeCents: 150000, incomePaidCents: 100000, expenseCents: 30000, expensePaidCents: 30000, resultCents: 120000, resultPaidCents: 70000, overdueCount: 1 });
    expect(cardCounts(db, a).finance).toBe(3);
    expect(cardFinance(db, b).entries).toHaveLength(1);
    // nova leitura sem lançamentos para A: some tudo de A, B fica
    replaceFinance(db, actx, [a], [], "demo", "2026-10-21T10:00:00.000Z");
    expect(cardFinance(db, a)).toMatchObject({ entries: [], env: "demo", syncedAt: "2026-10-21T10:00:00.000Z" });
    expect(cardFinance(db, b).entries).toHaveLength(1);
    expect(summarize([]).resultCents).toBe(0);
  });
});

describe("Fase 3: relatório financeiro e financeiro do cliente", async () => {
  const { setCardStatus } = await import("../src/db/deals");
  const { clientFinance, financeReport, financeSyncedAt, replaceAllFinance } = await import("../src/db/finance");

  it("leitura geral substitui tudo; relatório por base, escopo e grupos; ganhos com receita a lançar", async () => {
    const { db, actx, card } = await setup();
    const org = createOrganization(db, actx, { name: "Escola A" });
    const pessoa = createPerson(db, actx, { name: "Maria" });
    const a = card("Projeto A", { organizationId: org, valueCents: 200000 });
    const b = card("Projeto B", { personId: pessoa, valueCents: 50000 });
    const c = card("Sem lançamento", { organizationId: org, valueCents: 70000 });
    setCardStatus(db, actx, a, { status: "won" });
    setCardStatus(db, actx, c, { status: "won" });
    replaceFinance(db, actx, [a], [item({ id: "velho", ref: a, type: "income", amountCents: 1 })], "production", "2026-01-01T00:00:00Z");

    replaceAllFinance(db, actx, [
      item({ id: "r1", ref: a, type: "income", amountCents: 120000, status: "paid", competenceDate: "2026-09-10", dueDate: "2026-09-20", paymentDate: "2026-10-02", category: "Vendas" }),
      item({ id: "r2", ref: a, type: "income", amountCents: 30000, competenceDate: "2026-10-05", dueDate: "2026-10-01", category: "Vendas" }),
      item({ id: "d1", ref: a, type: "expense", amountCents: 40000, status: "paid", competenceDate: "2026-10-03", dueDate: "2026-10-03", paymentDate: "2026-10-03", category: "Terceiros", subcategory: "Instalação" }),
      item({ id: "r3", ref: b, type: "income", amountCents: 50000, competenceDate: "2026-10-15", dueDate: "2026-11-15" }),
      item({ id: "x", ref: "cartao-apagado", type: "income", amountCents: 999, competenceDate: "2026-10-01" }),
    ], "production", "2026-10-20T12:00:00.000Z");
    expect(financeSyncedAt(db)).toEqual({ at: "2026-10-20T12:00:00.000Z", env: "production" });
    expect(cardFinance(db, a).entries.map((e) => e.id).sort()).toEqual(["d1", "r1", "r2"]); // "velho" saiu

    const f = { start: "2026-10-01", end: "2026-10-31", today: "2026-10-20" } as const;
    const comp = financeReport(db, { ...f, basis: "competencia" });
    expect(comp.totals).toMatchObject({ incomeCents: 80000, expenseCents: 40000, resultCents: 40000, margin: 0.5, receivableCents: 80000, overdueReceivableCents: 30000 });
    expect(comp.cards.map((x) => [x.title, x.resultCents])).toEqual([["Projeto B", 50000], ["Projeto A", -10000]]);
    expect(comp.clients.map((x) => [x.name, x.cards, x.resultCents])).toEqual([["Maria", 1, 50000], ["Escola A", 1, -10000]]);
    expect(comp.categories).toEqual([
      { type: "income", name: "Sem categoria", amountCents: 50000 },
      { type: "income", name: "Vendas", amountCents: 30000 },
      { type: "expense", name: "Terceiros › Instalação", amountCents: 40000 },
    ]);
    expect(comp.months).toEqual([{ month: "2026-10", incomeCents: 80000, expenseCents: 40000, resultCents: 40000 }]);

    // Caixa: só o que foi pago/recebido, pela data do pagamento (r1 recebido em 02/10).
    const caixa = financeReport(db, { ...f, basis: "caixa" });
    expect(caixa.totals).toMatchObject({ incomeCents: 120000, expenseCents: 40000, resultCents: 80000 });
    // Vencimento: r2 vence 01/10, r3 em novembro (fora).
    expect(financeReport(db, { ...f, basis: "vencimento" }).totals.incomeCents).toBe(30000);
    // Filtro pela situação do cartão.
    expect(financeReport(db, { ...f, basis: "competencia", cardStatus: "won" }).cards.map((x) => x.title)).toEqual(["Projeto A"]);

    // Ganhos no período com receita por lançar (tudo o que já foi lançado conta, de qualquer data).
    const hoje = new Date().toLocaleDateString("sv-SE");
    const bill = financeReport(db, { start: hoje, end: hoje, basis: "competencia" }).toBill;
    expect(bill.map((x) => [x.title, x.launchedCents, x.missingCents])).toEqual([["Sem lançamento", 0, 70000], ["Projeto A", 150000, 50000]]);

    // Vendedor só vê os cartões dele.
    const vend = createUser(db, actx, { name: "Vend", role: "vendedor" });
    const { getViewer } = await import("../src/db/users");
    expect(financeReport(db, { ...f, basis: "competencia", viewer: getViewer(db, vend) }).cards).toEqual([]);
  });

  it("financeiro do cliente: cartões da organização / do contato principal e o que falta receber", async () => {
    const { db, actx, card } = await setup();
    const org = createOrganization(db, actx, { name: "Escola A" });
    const pessoa = createPerson(db, actx, { name: "Maria" });
    const a = card("A", { organizationId: org, personId: pessoa });
    const b = card("B", { organizationId: org });
    const c = card("C", { personId: pessoa });
    replaceAllFinance(db, actx, [
      item({ id: "1", ref: a, type: "income", amountCents: 1000, dueDate: "2000-01-01" }),
      item({ id: "2", ref: b, type: "income", amountCents: 500, status: "paid", paymentDate: "2026-10-01" }),
      item({ id: "3", ref: b, type: "expense", amountCents: 200 }),
      item({ id: "4", ref: c, type: "income", amountCents: 300, dueDate: "2999-01-01" }),
    ], "production", "2026-10-20T00:00:00Z");
    const o = clientFinance(db, { organizationId: org }, null, "2026-10-20");
    expect(o.totals).toMatchObject({ incomeCents: 1500, expenseCents: 200, resultCents: 1300, receivableCents: 1000, overdueReceivableCents: 1000 });
    expect(o.cards.map((x) => [x.title, x.resultCents])).toEqual([["A", 1000], ["B", 300]]);
    expect(o.receivables.map((r) => [r.id, r.cardTitle])).toEqual([["1", "A"]]);
    const p = clientFinance(db, { personId: pessoa }, null, "2026-10-20");
    expect(p.cards.map((x) => x.title).sort()).toEqual(["A", "C"]);
    expect(p.receivables.map((r) => r.id)).toEqual(["1", "4"]);
  });
});

describe("Fase 4: pacote, alertas e Copiloto", async () => {
  const { setCardStatus } = await import("../src/db/deals");
  const f = await import("../src/db/finance");
  const cop = await import("../src/db/copilot");
  const { PACKAGE_FORMAT } = await import("../src/lib/finance/protocol");

  it("pedidos no pacote: valida, exporta (de novo até voltar), importa o retorno e marca lançados", async () => {
    const { db, actx, card } = await setup();
    const org = createOrganization(db, actx, { name: "Escola A", cnpj: "19489640000135" });
    const a = card("Projeto A", { organizationId: org, valueCents: 100000 });
    const sem = card("Sem cliente");
    expect(() => f.createFinanceRequest(db, actx, sem, { mode: "income", description: "x", amountCents: 1 })).toThrow(/vincule uma organização ou um contato/);
    expect(() => f.createFinanceRequest(db, actx, a, { mode: "income", description: " ", amountCents: 1 })).toThrow(/descrição/);
    expect(() => f.createFinanceRequest(db, actx, a, { mode: "income", description: "x", amountCents: -5 })).toThrow(/Valor inválido/);
    const r1 = f.createFinanceRequest(db, actx, a, { mode: "income", description: "Entrada", amountCents: 50000, dueDate: "2026-11-10" });
    const r2 = f.createFinanceRequest(db, actx, a, { mode: "expense", description: "Viagem", amountCents: null });
    const list = f.listFinanceRequests(db, a);
    expect(list.map((r) => [r.status, r.request.counterparty.name, r.request.origin.label])).toEqual([
      ["pending", "Escola A", 'Negócio "Projeto A" (ConectCRM)'],
      ["pending", "Escola A", 'Negócio "Projeto A" (ConectCRM)'],
    ]);
    expect(f.financeRequestCounts(db)).toEqual({ pending: 2, exported: 0, contacts: 1 }); // o cliente do pedido vai junto

    const pkg = f.exportFinanceRequests(db, "0.2.57");
    expect(pkg).toMatchObject({ format: PACKAGE_FORMAT, kind: "requests", from: { app: "conectcrm" } });
    expect(pkg.requests.map((r) => r.id)).toEqual([r1, r2]);
    expect(f.financeRequestCounts(db)).toEqual({ pending: 0, exported: 2, contacts: 0 });
    expect(f.exportFinanceRequests(db, "0.2.57").requests).toHaveLength(2); // até o retorno, vão de novo

    const res = f.importFinanceReturn(db, actx, {
      format: PACKAGE_FORMAT, version: 1, kind: "return", createdAt: "2026-10-21T10:00:00.000Z", from: { app: "gestao-financeira", version: "0.0.7" }, env: "production",
      items: [item({ id: "t1", ref: a, type: "income", amountCents: 50000, requestId: r1 })],
    });
    expect(res).toEqual({ items: 1, launched: 1 });
    expect(f.listFinanceRequests(db, a).map((r) => r.id)).toEqual([r2]);
    expect(f.cardFinance(db, a).entries.map((e) => e.id)).toEqual(["t1"]);
    expect(() => f.discardFinanceRequest(db, r1)).toThrow(/já foi lançado/);
    f.discardFinanceRequest(db, r2);
    expect(f.listFinanceRequests(db, a)).toEqual([]);
  });

  it("alertas: receitas atrasadas e a vencer, despesas atrasadas, ganhos com receita a lançar (descontando pedidos); linhas do resumo diário", async () => {
    const { db, actx, card } = await setup();
    const org = createOrganization(db, actx, { name: "Escola A" });
    const a = card("Projeto A", { organizationId: org, valueCents: 100000 });
    const b = card("Projeto B", { organizationId: org, valueCents: 80000 });
    const c = card("Projeto C", { organizationId: org, valueCents: 30000 });
    for (const id of [a, b, c]) setCardStatus(db, actx, id, { status: "won" });
    db.exec(`UPDATE deal SET closed_at = '2026-10-01T12:00:00.000Z'`);
    expect(f.financeAlerts(db, null, { today: "2026-10-20" })).toMatchObject({ inUse: false, wonWithoutIncome: [] });

    f.replaceAllFinance(db, actx, [
      item({ id: "1", ref: a, type: "income", amountCents: 40000, dueDate: "2026-10-05" }),
      item({ id: "2", ref: a, type: "income", amountCents: 60000, dueDate: "2026-10-25" }),
      item({ id: "3", ref: b, type: "expense", amountCents: 1000, dueDate: "2026-10-01" }),
    ], "production", "2026-10-20T08:00:00.000Z");
    f.createFinanceRequest(db, actx, c, { mode: "income", description: "C", amountCents: 30000 });
    const al = f.financeAlerts(db, null, { today: "2026-10-20" });
    expect(al.overdueReceivables.map((x) => [x.cardTitle, x.amountCents, x.daysLate])).toEqual([["Projeto A", 40000, 15]]);
    expect(al.dueSoon.map((x) => x.amountCents)).toEqual([60000]);
    expect(al.overduePayables).toEqual({ count: 1, amountCents: 1000 });
    // A: tudo lançado; B: nada lançado; C: pedido no pacote cobre o valor.
    expect(al.wonWithoutIncome.map((x) => [x.cardTitle, x.missingCents, x.days])).toEqual([["Projeto B", 80000, 19]]);

    const lines = f.financeDigestLines(al, true);
    expect(lines[0]).toBe("Financeiro:");
    expect(lines.join("\n")).toMatch(/\*1 receita atrasada \(R\$\s400,00\)\*/);
    expect(lines.join("\n")).toMatch(/Projeto B: falta R\$\s800,00/);
    expect(f.financeDigestLines({ ...al, overdueReceivables: [], dueSoon: [], wonWithoutIncome: [], overduePayables: { count: 0, amountCents: 0 } }, false)).toEqual([]);
    // "Não registrar no financeiro": B sai dos avisos (e volta se desfizer).
    f.setFinanceSkip(db, actx, b, true);
    expect(f.financeAlerts(db, null, { today: "2026-10-20" }).wonWithoutIncome).toEqual([]);
    f.setFinanceSkip(db, actx, b, false);
    expect(f.financeAlerts(db, null, { today: "2026-10-20" }).wonWithoutIncome).toHaveLength(1);

    // Copiloto
    const s = cop.financeSummaryForCopilot(db, null, { de: "2026-10-01", ate: "2026-10-31" }) as { totais: { receitas: string; resultado: string } };
    expect(s.totais.receitas).toMatch(/1\.000,00/);
    expect(cop.financeSummaryForCopilot(db, null, { de: "x", ate: "y" })).toHaveProperty("erro");
    // O Copiloto usa a data de hoje: fixa no dia do cenário.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00"));
    const p = cop.financeAlertsForCopilot(db, null, {}) as { receitasAtrasadas: { diasDeAtraso: number }[]; ganhosComReceitaALancar: { cartao: string }[] };
    vi.useRealTimers();
    expect(p.receitasAtrasadas).toHaveLength(1);
    expect(p.ganhosComReceitaALancar.map((x) => x.cartao)).toEqual(["Projeto B"]);
    expect(cop.cardFinanceForCopilot(db, a)?.lancamentos).toHaveLength(2);
    expect(cop.cardFinanceForCopilot(db, c)).toBeNull();
  });
});
