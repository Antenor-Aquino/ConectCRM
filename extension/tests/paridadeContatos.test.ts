// Paridade dos cadastros de contato/organização com a Gestão Financeira
// (spec 13): toda coluna de `person` e `organization` tem decisão (vai para um
// campo da ficha ou "não vai: motivo"); todo campo da ficha é preenchido; e as
// alterações ficam pendentes até serem enviadas.
import { describe, expect, it } from "vitest";
import { createOrganization, createPerson } from "../src/db/contacts";
import { contactCardFor, organizationCard, ORGANIZATION_COLUMNS, PERSON_COLUMNS, personCard, RELATED_FIELDS } from "../src/db/contactCard";
import { createCustomField } from "../src/db/customFields";
import { createTag } from "../src/db/tags";
import * as f from "../src/db/finance";
import { methods } from "../src/rpc/methods";
import { CONTACT_CARD_FIELDS, type ContactCard } from "../src/lib/finance/protocol";
import { freshDb } from "./helpers";

const columns = (db: Awaited<ReturnType<typeof freshDb>>["db"], table: string) =>
  db.exec(`PRAGMA table_info(${table})`)[0]!.values.map((v) => String(v[1])).sort();
const get = (c: ContactCard, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | null | undefined)?.[k], c);

describe("paridade de cadastros com a Gestão Financeira", () => {
  it("toda coluna de contato e organização tem decisão (vai para a ficha ou motivo de não ir)", async () => {
    const { db } = await freshDb();
    expect(Object.keys(PERSON_COLUMNS).sort()).toEqual(columns(db, "person"));
    expect(Object.keys(ORGANIZATION_COLUMNS).sort()).toEqual(columns(db, "organization"));
    // E todo campo da ficha vem de algum lugar.
    const covered = new Set([...Object.values(PERSON_COLUMNS), ...Object.values(ORGANIZATION_COLUMNS), ...RELATED_FIELDS].filter((v) => !v.startsWith("não vai")));
    expect([...CONTACT_CARD_FIELDS].filter((x) => !covered.has(x))).toEqual([]);
  });

  it("a ficha leva tudo: organização (endereço, razão social, tags, campos) e contato (CPF, empresa)", async () => {
    const { db, ctx } = await freshDb();
    const area = createCustomField(db, ctx, { entity: "organization", name: "Área de atuação", fieldType: "text" });
    const cargo = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text" });
    createCustomField(db, ctx, { entity: "person", name: "Interno", fieldType: "text", hidden: true });
    const tagOrg = createTag(db, ctx, { entity: "organization", name: "Prioridade" });
    const org = createOrganization(db, ctx, {
      name: "AEB Sistemas", legalName: "AEB Sistemas LTDA", cnpj: "19.489.640/0001-35", website: "aeb.com.br", segment: "Saúde", phone: "31999998888",
      email: "contato@aeb.com.br", cep: "30130-000", street: "Av. Afonso Pena", number: "1000", complement: "Sala 2", district: "Centro", city: "Belo Horizonte",
      state: "MG", country: "Brasil", description: "Cliente desde 2020", tagIds: [tagOrg], customValues: { [area]: "Saúde" },
    });
    const card = organizationCard(db, org)!;
    const pathsPJ = CONTACT_CARD_FIELDS.filter((x) => !x.startsWith("company."));
    for (const p of pathsPJ) expect([p, get(card, p) ?? null]).not.toEqual([p, null]);
    expect(card).toMatchObject({ crmRef: `organization:${org}`, kind: "PJ", legalName: "AEB Sistemas LTDA", document: "19489640000135", address: { city: "Belo Horizonte", state: "MG" }, tags: ["Prioridade"], customFields: [{ label: "Área de atuação", value: "Saúde" }] });

    const maria = createPerson(db, ctx, { name: "Maria José", cpf: "529.982.247-25", email: "maria@aeb.com.br", phone: "31988887777", notes: "Decide compras", organizationIds: [org], customValues: { [cargo]: "Diretora" } });
    expect(personCard(db, maria)).toMatchObject({
      crmRef: `person:${maria}`, kind: "PF", document: "52998224725", phoneCountry: "BR", notes: "Decide compras",
      company: { crmRef: `organization:${org}`, name: "AEB Sistemas" }, customFields: [{ label: "Cargo", value: "Diretora" }],
    });
    expect(contactCardFor(db, "person:x")).toBeNull();
  });

  it("alterações dos cadastros que estão lá ficam pendentes (inclusive contatos da organização alterada) até o envio", async () => {
    const { db, ctx } = await freshDb();
    const org = createOrganization(db, ctx, { name: "AEB" });
    const maria = createPerson(db, ctx, { name: "Maria", organizationIds: [org] });
    const joao = createPerson(db, ctx, { name: "João" });
    const call = <T,>(m: string, p: unknown) => (methods as unknown as Record<string, (db: unknown, ctx: unknown, p: unknown) => T>)[m]!(db, ctx, p);

    // Fora da Gestão Financeira: alterar não gera nada.
    call("persons.update", { id: joao, patch: { notes: "x" } });
    expect(f.pendingContactCards(db)).toEqual([]);

    f.linkFinanceContact(db, ctx, `person:${maria}`, true); // foi junto num lançamento
    f.linkFinanceContact(db, ctx, `organization:${org}`); // botão "Enviar"
    expect(f.pendingContactCards(db).map((c) => c.crmRef)).toEqual([`organization:${org}`]);
    f.markContactsSent(db, [`organization:${org}`]);
    expect(f.pendingContactCards(db)).toEqual([]);

    call("organizations.update", { id: org, patch: { name: "AEB Sistemas" } });
    const pend = f.pendingContactCards(db);
    expect(pend.map((c) => c.crmRef).sort()).toEqual([`organization:${org}`, `person:${maria}`].sort());
    expect(pend.find((c) => c.kind === "PF")!.company?.name).toBe("AEB Sistemas");
    expect(f.financeContactStatus(db, `person:${maria}`)).toMatchObject({ pending: true });
    expect(f.financeRequestCounts(db).contacts).toBe(2);

    // O pacote leva os pendentes e marca como enviados.
    const pkg = f.exportFinanceRequests(db, "0.2.59");
    expect(pkg.requests).toEqual([]);
    expect(pkg.contacts!.map((c) => c.name).sort()).toEqual(["AEB Sistemas", "Maria"]);
    expect(f.pendingContactCards(db)).toEqual([]);

    call("persons.update", { id: maria, patch: { email: "maria@aeb.com" } });
    expect(f.pendingContactCards(db).map((c) => c.email)).toEqual(["maria@aeb.com"]);
    // Excluído do CRM sai da fila (o cadastro financeiro continua lá).
    db.exec(`UPDATE person SET deleted_at = '2026-10-20' WHERE id = '${maria}'`);
    expect(f.pendingContactCards(db)).toEqual([]);
  });
});
