// Integração com a Gestão Financeira, Fase 2 (spec 13): cliente/fornecedor do
// cartão, CPF do contato e a cópia local dos lançamentos.
import { describe, expect, it } from "vitest";
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
    expect(cardCounterparty(db, c1)).toEqual({ crmRef: `organization:${org}`, kind: "PJ", name: "Caixa Escolar", document: "19489640000135", email: "escola@mg.gov.br", phone: null });
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
