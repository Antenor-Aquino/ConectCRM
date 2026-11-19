// Várias organizações no cartão: principal + vinculadas com papel; o pagador
// vale para cobrança, NFS-e (tomador) e Gestão Financeira.
import { describe, expect, it } from "vitest";
import * as co from "../src/db/cardOrganizations";
import { chargeDraftForCard } from "../src/db/charges";
import { createOrganization } from "../src/db/contacts";
import { cardHistory } from "../src/db/cardHistory";
import { cloneCard, createCard, getBoard, listCardsForEntity, searchCards, updateCard } from "../src/db/deals";
import { cardCounterparty, clientFinance } from "../src/db/finance";
import { mergeRecords } from "../src/db/mergeRecords";
import { nfseDraftForCard } from "../src/db/nfse";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const me = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ctx = { ...sys, userId: me };
  const pl = createPipeline(db, ctx, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  const escola = createOrganization(db, ctx, { name: "EE Professora Celina Machado" });
  const caixa = createOrganization(db, ctx, {
    name: "Caixa Escolar Celina Machado",
    legalName: "CAIXA ESCOLAR PROFESSORA CELINA MACHADO",
    cnpj: "19929587000146",
    cep: "38067230",
    street: "Rua A",
    city: "Uberaba",
    state: "MG",
  } as Parameters<typeof createOrganization>[2]);
  const mant = createOrganization(db, ctx, { name: "Rede Saber Mantenedora" });
  const escola2 = createOrganization(db, ctx, { name: "Escola Saber Unidade 2" });
  const card = createCard(db, ctx, { pipelineId: pl, title: "Licenças 2027", organizationId: escola, valueCents: 49500 });
  return { db, ctx, pl, escola, caixa, mant, escola2, card };
}

describe("organizações do cartão", () => {
  it("vincula com papel, um pagador só, principal primeiro", async () => {
    const { db, ctx, card, escola, caixa, mant, escola2 } = await setup();
    co.addCardOrganization(db, ctx, card, mant, "mantenedora");
    co.addCardOrganization(db, ctx, card, escola2, "cliente");
    co.addCardOrganization(db, ctx, card, caixa, "pagador");
    expect(co.listCardOrganizations(db, card).map((o) => [o.name, o.role, o.is_payer])).toEqual([
      ["EE Professora Celina Machado", "principal", 0],
      ["Caixa Escolar Celina Machado", "pagador", 1],
      ["Rede Saber Mantenedora", "mantenedora", 0],
      ["Escola Saber Unidade 2", "cliente", 0],
    ]);
    // Outro pagador: o anterior vira "Outra".
    co.setCardOrganizationRole(db, ctx, card, mant, "pagador");
    expect(co.listCardOrganizations(db, card).find((o) => o.id === caixa)!.role).toBe("outra");
    expect(co.payerOrganizationId(db, card)).toBe(mant);
    // Vincular de novo a mesma muda só o papel; a principal não duplica.
    co.addCardOrganization(db, ctx, card, caixa, "pagador");
    co.addCardOrganization(db, ctx, card, escola, "cliente");
    expect(co.listCardOrganizations(db, card)).toHaveLength(4);
    expect(co.payerOrganizationId(db, card)).toBe(caixa);
    expect(() => co.setCardOrganizationRole(db, ctx, card, escola, "pagador")).toThrow(/principal/);
    expect(() => co.addCardOrganization(db, ctx, card, caixa, "dono" as never)).toThrow(/Papel/);
  });

  it("sem pagador, quem paga é a principal; trocar e tirar a principal", async () => {
    const { db, ctx, card, escola, escola2, mant } = await setup();
    expect(co.payerOrganizationId(db, card)).toBe(escola);
    co.addCardOrganization(db, ctx, card, mant, "mantenedora");
    co.addCardOrganization(db, ctx, card, escola2, "cliente");
    co.setPrimaryCardOrganization(db, ctx, card, escola2);
    expect(co.listCardOrganizations(db, card).map((o) => [o.id, o.role])).toEqual([
      [escola2, "principal"],
      [mant, "mantenedora"],
      [escola, "cliente"],
    ]);
    co.removeCardOrganization(db, ctx, card, escola2);
    expect(co.listCardOrganizations(db, card).map((o) => [o.id, o.role])).toEqual([
      [escola, "principal"],
      [mant, "mantenedora"],
    ]);
    // Editar o cartão escolhendo uma vinculada como organização: sai das vinculadas.
    updateCard(db, ctx, card, { organizationId: mant });
    expect(co.listCardOrganizations(db, card).map((o) => o.role)).toEqual(["principal"]);
  });

  it("sem principal, a 1ª unidade/outra vira principal; pagador fica como pagador", async () => {
    const { db, ctx, pl, caixa, escola } = await setup();
    const c = createCard(db, ctx, { pipelineId: pl, title: "Sem org" });
    co.addCardOrganization(db, ctx, c, caixa, "pagador");
    expect(co.listCardOrganizations(db, c).map((o) => o.role)).toEqual(["pagador"]);
    co.addCardOrganization(db, ctx, c, escola, "cliente");
    expect(co.listCardOrganizations(db, c).map((o) => [o.id, o.role])).toEqual([
      [escola, "principal"],
      [caixa, "pagador"],
    ]);
  });

  it("pagador vira tomador da NFS-e, pagador do boleto e cliente na Gestão Financeira", async () => {
    const { db, ctx, card, caixa } = await setup();
    co.addCardOrganization(db, ctx, card, caixa, "pagador");
    expect(nfseDraftForCard(db, card).taker).toMatchObject({ kind: "organization", id: caixa, document: "19929587000146", name: "CAIXA ESCOLAR PROFESSORA CELINA MACHADO" });
    expect(chargeDraftForCard(db, card).payer).toMatchObject({ kind: "JURIDICA", document: "19929587000146", city: "Uberaba" });
    expect(cardCounterparty(db, card)).toMatchObject({ crmRef: `organization:${caixa}` });
  });

  it("aparece nos cartões da organização vinculada, na busca e no financeiro dela", async () => {
    const { db, ctx, card, mant, pl } = await setup();
    co.addCardOrganization(db, ctx, card, mant, "mantenedora");
    expect(listCardsForEntity(db, { organizationId: mant }).map((c) => c.id)).toEqual([card]);
    // Financeiro da organização: o cartão vinculado entra na consulta (sem lançamentos ainda).
    expect(() => clientFinance(db, { organizationId: mant })).not.toThrow();
    expect(searchCards(db, "Saber Mantenedora").map((c) => c.id)).toEqual([card]);
    expect(JSON.stringify(getBoard(db, pl, { search: "Saber Mantenedora" }))).toContain(card);
  });

  it("histórico, clonar e mesclar cartões/organizações", async () => {
    const { db, ctx, pl, card, caixa, mant, escola } = await setup();
    co.addCardOrganization(db, ctx, card, caixa, "pagador");
    co.setCardOrganizationRole(db, ctx, card, caixa, "mantenedora");
    const lines = cardHistory(db, card).flatMap((e) => e.lines);
    expect(lines).toContain("Vinculou a organização Caixa Escolar Celina Machado (Pagador)");
    expect(lines).toContain("Organização Caixa Escolar Celina Machado: papel Pagador → Mantenedora");

    const clone = cloneCard(db, ctx, card, { pipelineId: pl });
    expect(co.listCardOrganizations(db, clone).map((o) => [o.id, o.role])).toEqual([
      [escola, "principal"],
      [caixa, "mantenedora"],
    ]);

    // Mescla de cartões: vinculadas e a principal do que sai vão para o que fica.
    const other = createCard(db, ctx, { pipelineId: pl, title: "Duplicado", organizationId: mant });
    mergeRecords(db, ctx, { entity: "deal", keepId: card, removeId: other });
    expect(co.listCardOrganizations(db, card).map((o) => [o.id, o.role])).toEqual([
      [escola, "principal"],
      [caixa, "mantenedora"],
      [mant, "cliente"],
    ]);

    // Mescla de organizações: o vínculo passa para a que fica, sem duplicar a principal.
    mergeRecords(db, ctx, { entity: "organization", keepId: escola, removeId: caixa });
    expect(co.listCardOrganizations(db, card).map((o) => o.id)).toEqual([escola, mant]);
  });
});

describe("tipo da organização no cadastro", () => {
  it("vale como papel ao vincular (sem papel escolhido); papel escolhido manda; tipo inválido recusado", async () => {
    const { db, ctx, card, caixa, mant, escola2 } = await setup();
    const { updateOrganization } = await import("../src/db/contacts");
    updateOrganization(db, ctx, caixa, { orgType: "pagador" });
    updateOrganization(db, ctx, mant, { orgType: "mantenedora" });
    co.addCardOrganization(db, ctx, card, caixa);
    co.addCardOrganization(db, ctx, card, mant, "outra");
    co.addCardOrganization(db, ctx, card, escola2);
    const roles = Object.fromEntries(co.listCardOrganizations(db, card).map((o) => [o.id, o.role]));
    expect(roles).toMatchObject({ [caixa]: "pagador", [escola2]: "outra", [mant]: "outra" });
    expect(() => updateOrganization(db, ctx, caixa, { orgType: "dono" as never })).toThrow(/Tipo de organização inválido/);
    updateOrganization(db, ctx, caixa, { orgType: null });
  });
});
