// Cobrança Banco Inter (spec 22): corpo do boleto, emissão assíncrona,
// situação → CRM (nota) e o registro no banco.
import { describe, expect, it } from "vitest";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import * as ch from "../src/db/charges";
import { listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import {
  buildCobranca,
  chargeStatusOf,
  emitCobranca,
  emptyPayer,
  INTER_DEFAULTS,
  InterError,
  interApi,
  interErrorMessage,
  newSeuNumero,
  parseCobranca,
  payerProblems,
  type InterPayer,
} from "../src/lib/inter";
import { interChargeNotes } from "../src/dashboard/cards/ChargeDialog";
import { freshDb } from "./helpers";

const payer: InterPayer = {
  ...emptyPayer(),
  kind: "JURIDICA",
  document: "68.153.622/0001-93",
  name: "Caixa Escolar Prof. Hildebrando Pontes",
  email: "escola@educacao.mg.gov.br",
  phone: "+55 (34) 99999-1234",
  cep: "38400-000",
  street: "Rua das Flores",
  number: "100",
  district: "Centro",
  city: "Uberlândia",
  state: "mg",
};

/** Fiscal simulado: responde por método + caminho. */
function fakeFiscal(routes: Record<string, (body: unknown) => { httpStatus: number; body: unknown }>) {
  const calls: { method: string; path: string; body: unknown; scopes: string }[] = [];
  const fn = (async (msg: Record<string, unknown>) => {
    const key = `${msg.method} ${msg.path}`;
    const body = msg.body ? JSON.parse(String(msg.body)) : undefined;
    calls.push({ method: String(msg.method), path: String(msg.path), body, scopes: String(msg.scopes) });
    const r = routes[key];
    if (!r) return { id: "1", ok: true, http: { httpStatus: 404, body: JSON.stringify({ title: "não achei" }) } };
    const out = r(body);
    return { id: "1", ok: true, http: { httpStatus: out.httpStatus, body: JSON.stringify(out.body) } };
  }) as unknown as Parameters<typeof interApi>[4];
  return { fn: fn!, calls };
}

describe("boleto do Inter — corpo e validações", () => {
  it("monta o corpo com pagador, multa, juros, cancelamento e Pix", () => {
    const b = buildCobranca({ seuNumero: "C26111514300012", amountCents: 5200, dueDate: "2026-11-30", payer, settings: { ...INTER_DEFAULTS, message: "Obrigado!" } });
    expect(b).toMatchObject({
      seuNumero: "C26111514300012",
      valorNominal: 52,
      dataVencimento: "2026-11-30",
      numDiasAgenda: 30,
      formasRecebimento: ["BOLETO", "PIX"],
      multa: { codigo: "PERCENTUAL", taxa: 2 },
      mora: { codigo: "TAXAMENSAL", taxa: 1 },
      mensagem: { linha1: "Obrigado!" },
    });
    expect(b.pagador).toEqual({
      cpfCnpj: "68153622000193",
      tipoPessoa: "JURIDICA",
      nome: "Caixa Escolar Prof. Hildebrando Pontes",
      endereco: "Rua das Flores",
      numero: "100",
      bairro: "Centro",
      cidade: "Uberlândia",
      uf: "MG",
      cep: "38400000",
      email: "escola@educacao.mg.gov.br",
      ddd: "34",
      telefone: "999991234",
    });
  });

  it("sem multa/juros não manda os campos; valida mínimo, pagador e prazo", () => {
    const b = buildCobranca({ seuNumero: "C1", amountCents: 250, dueDate: "2026-11-30", payer, settings: { finePct: 0, interestPctMonth: 0, cancelAfterDays: 0, message: "" } });
    expect(b.multa).toBeUndefined();
    expect(b.mora).toBeUndefined();
    expect(b.mensagem).toBeUndefined();
    expect(() => buildCobranca({ seuNumero: "C1", amountCents: 249, dueDate: "2026-11-30", payer, settings: INTER_DEFAULTS })).toThrow(/R\$ 2,50/);
    expect(() => buildCobranca({ seuNumero: "C1", amountCents: 500, dueDate: "2026-11-30", payer: { ...payer, cep: "" }, settings: INTER_DEFAULTS })).toThrow(/CEP/);
    expect(() => buildCobranca({ seuNumero: "C1", amountCents: 500, dueDate: "2026-11-30", payer, settings: { ...INTER_DEFAULTS, cancelAfterDays: 61 } })).toThrow(/0 a 60/);
    expect(() => buildCobranca({ seuNumero: "C1234567890123456", amountCents: 500, dueDate: "2026-11-30", payer, settings: INTER_DEFAULTS })).toThrow(/15/);
  });

  it("o que falta no pagador", () => {
    expect(payerProblems(payer)).toEqual([]);
    expect(payerProblems({ ...emptyPayer(), kind: "FISICA", document: "123" })).toEqual([
      "CPF do pagador (11 dígitos).",
      "Nome do pagador.",
      "CEP do pagador (8 dígitos).",
      "Endereço (logradouro) do pagador.",
      "Cidade do pagador.",
      "UF do pagador (ex.: PE).",
    ]);
    expect(payerProblems({ ...payer, email: "x@" })).toEqual(["E-mail do pagador inválido."]);
  });

  it("seu número: 15 caracteres, com data e hora", () => {
    const n = newSeuNumero(new Date(2026, 10, 15, 14, 30, 5), () => 0.12);
    expect(n).toBe("C26111514300512");
    expect(n).toHaveLength(15);
  });

  it("situação do Inter → situação no CRM; mensagens de erro", () => {
    expect(chargeStatusOf("RECEBIDO")).toBe("paid");
    expect(chargeStatusOf("MARCADO_RECEBIDO")).toBe("paid");
    expect(chargeStatusOf("EXPIRADO")).toBe("canceled");
    expect(chargeStatusOf("ATRASADO")).toBe("open");
    expect(interErrorMessage(400, { title: "Requisição inválida", violacoes: [{ propriedade: "pagador.cep", razao: "inválido" }] })).toBe(
      "O Inter respondeu HTTP 400: Requisição inválida (pagador.cep: inválido).",
    );
    expect(interErrorMessage(403, {})).toMatch(/permissões/);
  });
});

describe("boleto do Inter — emissão (Fiscal simulado)", () => {
  it("emite, espera sair de EM_PROCESSAMENTO e devolve linha digitável e Pix", async () => {
    let gets = 0;
    const f = fakeFiscal({
      "POST /cobranca/v3/cobrancas": () => ({ httpStatus: 200, body: { codigoSolicitacao: "abc-123" } }),
      "GET /cobranca/v3/cobrancas/abc-123": () => {
        gets++;
        return gets < 2
          ? { httpStatus: 200, body: { cobranca: { codigoSolicitacao: "abc-123", seuNumero: "C1", situacao: "EM_PROCESSAMENTO", valorNominal: 52 } } }
          : {
              httpStatus: 200,
              body: {
                cobranca: { codigoSolicitacao: "abc-123", seuNumero: "C1", situacao: "A_RECEBER", valorNominal: 52 },
                boleto: { linhaDigitavel: "07790001", codigoBarras: "0779", nossoNumero: "123" },
                pix: { pixCopiaECola: "000201PIX", txid: "tx1" },
              },
            };
      },
    });
    const c = await emitCobranca("sandbox", { seuNumero: "C1", valorNominal: 52 }, { call: f.fn, sleep: async () => {} });
    expect(c).toMatchObject({ codigoSolicitacao: "abc-123", situacao: "A_RECEBER", linhaDigitavel: "07790001", pixCopiaECola: "000201PIX" });
    expect(f.calls[0]).toMatchObject({ method: "POST", path: "/cobranca/v3/cobrancas", body: { seuNumero: "C1" } });
    expect(f.calls[0]!.scopes).toContain("boleto-cobranca.write");
  });

  it("erro do Inter vira InterError com a mensagem legível", async () => {
    const f = fakeFiscal({ "POST /cobranca/v3/cobrancas": () => ({ httpStatus: 400, body: { title: "Seu número já utilizado" } }) });
    await expect(emitCobranca("sandbox", {}, { call: f.fn, sleep: async () => {} })).rejects.toBeInstanceOf(InterError);
    await expect(emitCobranca("sandbox", {}, { call: f.fn, sleep: async () => {} })).rejects.toThrow(/Seu número já utilizado/);
  });

  it("lê a resposta da consulta (valor recebido em texto)", () => {
    const c = parseCobranca({ cobranca: { codigoSolicitacao: "x", situacao: "RECEBIDO", dataSituacao: "2026-11-20", valorNominal: 52, valorTotalRecebido: "53.04" } });
    expect(c).toMatchObject({ situacao: "RECEBIDO", dataSituacao: "2026-11-20", valorTotalRecebido: 53.04, linhaDigitavel: null });
  });
});

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pc = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const org = createOrganization(db, ctx, {
    name: "Caixa Escolar",
    legalName: "Caixa Escolar Prof. Hildebrando Pontes",
    cnpj: "68153622000193",
    email: "escola@educacao.mg.gov.br",
    cep: "38400000",
    street: "Rua das Flores",
    number: "100",
    district: "Centro",
    city: "Uberlândia",
    state: "MG",
  } as Parameters<typeof createOrganization>[2]);
  const person = createPerson(db, ctx, { name: "Cristiane Souza", phone: "(34) 99999-1234", organizationIds: [org] });
  const card = createCard(db, ctx, { pipelineId: pc, title: "Certificado digital A1", organizationId: org, personId: person, valueCents: 5200 });
  return { db, ctx, card, org, pc, person };
}

const items = [{ description: "Certificado A3 - 24 meses", quantity: 1, priceCents: 5200 }];

describe("cobrança do Inter no banco", () => {
  it("pagador do boleto: organização com CNPJ e endereço; contato com CPF quando não há organização", async () => {
    const { db, ctx, card, pc } = await setup();
    expect(ch.chargeDraftForCard(db, card).payer).toMatchObject({
      kind: "JURIDICA",
      document: "68153622000193",
      name: "Caixa Escolar Prof. Hildebrando Pontes",
      cep: "38400000",
      city: "Uberlândia",
      state: "MG",
      phone: "+5534999991234",
    });
    const pf = createPerson(db, ctx, { name: "João Silva", cpf: "52998224725" } as Parameters<typeof createPerson>[2]);
    const c2 = createCard(db, ctx, { pipelineId: pc, title: "PF", personId: pf, valueCents: 1000 });
    expect(ch.chargeDraftForCard(db, c2).payer).toMatchObject({ kind: "FISICA", document: "52998224725", name: "João Silva", cep: "" });
  });

  it("grava o boleto, nota com linha digitável e Pix; baixa manual recusada", async () => {
    const { db, ctx, card } = await setup();
    const id = ch.saveInterCharge(db, ctx, card, {
      env: "sandbox",
      seuNumero: "C26111514300012",
      codigoSolicitacao: "abc-123",
      situacao: "A_RECEBER",
      items,
      description: "Boleto Inter — Certificado",
      dueDate: "2026-11-30",
      company: "Claudia Tecnologia",
      barcode: "07790001",
      pixCode: "000201PIX",
    });
    const c = ch.listCharges(db, card)[0]!;
    expect(c).toMatchObject({ id, provider: "inter", status: "open", provider_ref: "abc-123", provider_env: "sandbox", barcode: "07790001", pix_code: "000201PIX", url: "" });
    expect(listNotes(db, "deal", card)[0]!.body).toBe(
      "Cobrança Claudia Tecnologia gerada:\nValor: R$ 52,00\nVencimento 30/11/2026\nItem: Certificado A3 - 24 meses\nBoleto (linha digitável): 07790001\nPix copia e cola: 000201PIX\nPedido: C26111514300012",
    );
    expect(() => ch.setChargeStatus(db, ctx, id, "paid")).toThrow(/baixa vem do próprio Inter/);
    expect(ch.openInterCharges(db).map((x) => x.id)).toEqual([id]);
    expect(interChargeNotes({ seuNumero: "C1", barcode: "077", pixCode: "PIX", items })).toContain("Linha digitável: 077");
  });

  it("situação: vencido (nota), pago (data e valor recebido), depois some dos abertos", async () => {
    const { db, ctx, card } = await setup();
    const id = ch.saveInterCharge(db, ctx, card, { env: "producao", seuNumero: "C2", codigoSolicitacao: "k2", situacao: "A_RECEBER", items, description: "B", dueDate: "2026-11-30" });
    expect(ch.applyInterSituacao(db, ctx, id, { situacao: "A_RECEBER" }).changed).toBe(false);
    const late = ch.applyInterSituacao(db, ctx, id, { situacao: "ATRASADO" });
    expect(late.changed).toBe(false);
    expect(listNotes(db, "deal", card)[0]!.body).toContain("vencida");
    const paid = ch.applyInterSituacao(db, ctx, id, { situacao: "RECEBIDO", dataSituacao: "2026-12-02", receivedCents: 5304 });
    expect(paid).toMatchObject({ changed: true, from: "open", to: "paid", orderNsu: "C2", paidDate: "2026-12-02", cardId: card });
    const c = ch.listCharges(db, card)[0]!;
    expect(c).toMatchObject({ status: "paid", provider_status: "RECEBIDO", received_cents: 5304 });
    expect(c.paid_at!.slice(0, 10)).toBe("2026-12-02");
    expect(listNotes(db, "deal", card)[0]!.body).toBe("Cobrança Banco Inter de R$ 52,00 paga em 02/12/2026 (recebido R$ 53,04). Pedido: C2");
    expect(ch.openInterCharges(db)).toEqual([]);
  });

  it("cancelado/expirado → cancelada; PDF no GED uma vez só", async () => {
    const { db, ctx, card } = await setup();
    const id = ch.saveInterCharge(db, ctx, card, { env: "sandbox", seuNumero: "C3", codigoSolicitacao: "k3", situacao: "A_RECEBER", items, description: "B", dueDate: "2026-11-30" });
    const file = { sha256: "f".repeat(64), mime: "application/pdf", size: 10, filename: "b.pdf", location: "browser" as const };
    const doc = ch.saveChargePdf(db, ctx, id, { file, name: ch.boletoDocumentName("Caixa Escolar", 5200, "C3") });
    expect(ch.saveChargePdf(db, ctx, id, { file, name: "outro" })).toBe(doc);
    expect(ch.listCharges(db, card)[0]!.pdf_doc_id).toBe(doc);
    expect(ch.boletoDocumentName("Caixa Escolar", 5200, "C3")).toBe("Caixa Escolar - 52,00 - Boleto C3");
    expect(ch.applyInterSituacao(db, ctx, id, { situacao: "EXPIRADO" })).toMatchObject({ changed: true, to: "canceled" });
    expect(listNotes(db, "deal", card)[0]!.body).toContain("expirada");
  });
});
