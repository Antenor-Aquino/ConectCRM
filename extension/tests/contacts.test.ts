import { describe, expect, it } from "vitest";
import {
  createOrganization,
  createPerson,
  deleteOrganization,
  findDuplicatePersons,
  getOrganization,
  getPerson,
  listPersons,
  listSegments,
  setPrimaryOrganization,
  unlinkPersonOrganization,
  updatePerson,
} from "../src/db/contacts";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

describe("contatos", () => {
  it("cria contato com celular normalizado e responsável padrão = usuário atual", async () => {
    const { db, ctx } = await freshDb();
    const me = createUser(db, ctx, { name: "Antenor", role: "admin" });
    const id = createPerson(db, { ...ctx, userId: me }, { name: "Mieza", phone: "(41) 98888-7777", email: "Mieza@X.com" });
    const p = getPerson(db, id)!;
    expect(p).toMatchObject({ phone: "+5541988887777", phone_country: "BR", email: "mieza@x.com", owner_id: me });
  });

  it("acha duplicados por e-mail ou celular", async () => {
    const { db, ctx } = await freshDb();
    const id = createPerson(db, ctx, { name: "Jean", email: "jean@x.com", phone: "11999998888" });
    expect(findDuplicatePersons(db, { phone: "+55 (11) 99999-8888" })).toEqual([{ id, name: "Jean", match: "phone" }]);
    expect(findDuplicatePersons(db, { email: "JEAN@x.com" })).toEqual([{ id, name: "Jean", match: "email" }]);
    expect(findDuplicatePersons(db, { email: "jean@x.com", excludeId: id })).toEqual([]);
    expect(findDuplicatePersons(db, { email: "jea" })).toEqual([]);
  });

  it("busca por nome, e-mail ou telefone", async () => {
    const { db, ctx } = await freshDb();
    createPerson(db, ctx, { name: "Fábio Col Santa Ursula", phone: "82991112222" });
    createPerson(db, ctx, { name: "Regina", email: "regina@escola.com" });
    expect(listPersons(db, { search: "santa" }).map((p) => p.name)).toEqual(["Fábio Col Santa Ursula"]);
    expect(listPersons(db, { search: "escola" }).map((p) => p.name)).toEqual(["Regina"]);
    expect(listPersons(db, { search: "9111" }).map((p) => p.name)).toEqual(["Fábio Col Santa Ursula"]);
  });

  it("contato privado só aparece para responsável, criador e administradores", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
    const id = createPerson(db, { ...ctx, userId: ana }, { name: "Segredo", isPrivate: true });
    expect(getPerson(db, id, { id: ana, role: "vendedor" })).toBeDefined();
    expect(getPerson(db, id, { id: admin, role: "admin" })).toBeDefined();
    expect(getPerson(db, id, { id: bia, role: "vendedor" })).toBeUndefined();
    expect(listPersons(db, { viewer: { id: bia, role: "vendedor" } })).toHaveLength(0);
  });
});

describe("organizações", () => {
  it("valida CNPJ e impede duplicado", async () => {
    const { db, ctx } = await freshDb();
    expect(() => createOrganization(db, ctx, { name: "X", cnpj: "11.222.333/0001-82" })).toThrow(/CNPJ inválido/);
    createOrganization(db, ctx, { name: "ABMES", cnpj: "11.222.333/0001-81" });
    expect(() => createOrganization(db, ctx, { name: "Outra", cnpj: "11222333000181" })).toThrow(/já cadastrado em "ABMES"/);
  });

  it("primeira organização do contato vira a principal; desvincular promove a próxima", async () => {
    const { db, ctx } = await freshDb();
    const person = createPerson(db, ctx, { name: "Daniel" });
    const a = createOrganization(db, ctx, { name: "Colégio A", personIds: [person] });
    const b = createOrganization(db, ctx, { name: "Colégio B", personIds: [person] });
    const orgs = () => getPerson(db, person)!.organizations.map((o) => [o.name, o.is_primary]);
    expect(orgs()).toEqual([["Colégio A", 1], ["Colégio B", 0]]);
    setPrimaryOrganization(db, ctx, person, b);
    expect(orgs()).toEqual([["Colégio B", 1], ["Colégio A", 0]]);
    unlinkPersonOrganization(db, ctx, person, b);
    expect(orgs()).toEqual([["Colégio A", 1]]);
    deleteOrganization(db, ctx, a);
    expect(orgs()).toEqual([]);
  });

  it("atualizar organizações do contato sincroniza os vínculos", async () => {
    const { db, ctx } = await freshDb();
    const a = createOrganization(db, ctx, { name: "A" });
    const b = createOrganization(db, ctx, { name: "B" });
    const person = createPerson(db, ctx, { name: "Cris", organizationIds: [a] });
    updatePerson(db, ctx, person, { organizationIds: [b] });
    expect(getPerson(db, person)!.organizations).toEqual([{ id: b, name: "B", is_primary: 1 }]);
    expect(getOrganization(db, a)!.persons).toEqual([]);
  });

  it("país padrão Brasil, CEP só dígitos e segmentos sem repetição", async () => {
    const { db, ctx } = await freshDb();
    const id = createOrganization(db, ctx, { name: "PUC-PR", cep: "80215-901", segment: "Educação" });
    createOrganization(db, ctx, { name: "Pentágono", segment: "educação" });
    expect(getOrganization(db, id)).toMatchObject({ country: "Brasil", cep: "80215901" });
    expect(listSegments(db)).toHaveLength(1);
  });
});
