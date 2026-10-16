import { describe, expect, it } from "vitest";
import { createActivity, listActivities } from "../src/db/activities";
import { getDataUrls, saveImage } from "../src/db/attachments";
import { countOrganizations, countPersons, createOrganization, createPerson, getOrganization, getPerson, listOrganizations, listPersons } from "../src/db/contacts";
import { createCustomField } from "../src/db/customFields";
import { createCard, getCard, listCardsForEntity } from "../src/db/deals";
import { importOrganizations, importPersons } from "../src/db/importer";
import { mergeOrganizations, mergePersons } from "../src/db/merge";
import { addNote, listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { createTag } from "../src/db/tags";
import { createUser } from "../src/db/users";
import { cnpjToOrganizationFields, lookupCnpj, mergeCnpjData, normalizeBrasilApi, normalizeReceitaWs } from "../src/lib/cnpj";
import { lookupCep } from "../src/lib/cep";
import { freshDb } from "./helpers";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("listas de contatos e organizações", () => {
  it("filtra por tag e conta para a paginação", async () => {
    const { db, ctx } = await freshDb();
    const vip = createTag(db, ctx, { entity: "person", name: "VIP" });
    createPerson(db, ctx, { name: "A", tagIds: [vip] });
    createPerson(db, ctx, { name: "B" });
    createPerson(db, ctx, { name: "C", tagIds: [vip] });
    expect(listPersons(db, { tagIds: [vip] }).map((p) => p.name)).toEqual(["A", "C"]);
    expect(countPersons(db)).toBe(3);
    expect(listPersons(db, { limit: 2, offset: 2 }).map((p) => p.name)).toEqual(["C"]);
  });

  it("organizações: cidade/UF, contagem de contatos", async () => {
    const { db, ctx } = await freshDb();
    const puc = createOrganization(db, ctx, { name: "PUC-PR", city: "Curitiba", state: "PR" });
    createOrganization(db, ctx, { name: "Pentágono", city: "São Paulo", state: "SP" });
    createPerson(db, ctx, { name: "Mari", organizationIds: [puc] });
    expect(listOrganizations(db, { state: "pr" }).map((o) => [o.name, o.persons_count])).toEqual([["PUC-PR", 1]]);
    expect(countOrganizations(db, { city: "São Paulo" })).toBe(1);
  });
});

describe("foto e logo", () => {
  it("grava imagem e devolve como data URL", async () => {
    const { db, ctx } = await freshDb();
    const id = saveImage(db, ctx, { entityType: "person", filename: "foto.png", dataUrl: PNG });
    const person = createPerson(db, ctx, { name: "Com foto", avatarId: id });
    expect(getPerson(db, person)!.avatar_id).toBe(id);
    expect(getDataUrls(db, [id])[id]).toBe(PNG);
    expect(() => saveImage(db, ctx, { entityType: "person", filename: "x.txt", dataUrl: "data:text/plain;base64,eA==" })).toThrow(/imagem/);
  });
});

describe("mesclar duplicados", () => {
  it("contatos: negócios, tarefas, notas, organizações, tags e campos vão para o mantido", async () => {
    const { db, ctx } = await freshDb();
    const pipelineId = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const org = createOrganization(db, ctx, { name: "ABMES" });
    const tag = createTag(db, ctx, { entity: "person", name: "Aluno" });
    const cargo = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text" });
    const keep = createPerson(db, ctx, { name: "Dalliane", notes: "Primeira" });
    const dup = createPerson(db, ctx, { name: "Dalliane S.", email: "d@x.com", notes: "Segunda", organizationIds: [org], tagIds: [tag], customValues: { [cargo]: "Diretora" } });
    const deal = createCard(db, ctx, { pipelineId, title: "Negócio", personId: dup });
    createActivity(db, ctx, { title: "Ligar", personId: dup });
    addNote(db, ctx, "person", dup, "Nota antiga");
    mergePersons(db, ctx, keep, dup);
    const p = getPerson(db, keep)!;
    expect(p).toMatchObject({ email: "d@x.com", notes: "Primeira\n\nSegunda" });
    expect(p.organizations.map((o) => [o.name, o.is_primary])).toEqual([["ABMES", 1]]);
    expect(p.tags.map((t) => t.name)).toEqual(["Aluno"]);
    expect(p.customValues[cargo]).toBe("Diretora");
    expect(getCard(db, deal)!.person_id).toBe(keep);
    expect(listActivities(db, { personId: keep })).toHaveLength(1);
    expect(listNotes(db, "person", keep)).toHaveLength(1);
    expect(getPerson(db, dup)).toBeUndefined();
  });

  it("organizações: CNPJ passa para a mantida e ela vira a principal dos contatos", async () => {
    const { db, ctx } = await freshDb();
    const keep = createOrganization(db, ctx, { name: "ABMES" });
    const dup = createOrganization(db, ctx, { name: "Abmes Brasil", cnpj: "11222333000181", city: "Brasília" });
    const person = createPerson(db, ctx, { name: "Raquel", organizationIds: [dup] });
    mergeOrganizations(db, ctx, keep, dup);
    expect(getOrganization(db, keep)).toMatchObject({ cnpj: "11222333000181", city: "Brasília" });
    expect(getPerson(db, person)!.organizations).toEqual([{ id: keep, name: "ABMES", is_primary: 1 }]);
  });
});

describe("ficha: cartões ligados", () => {
  it("mostra só os cartões que o usuário pode ver", async () => {
    const { db, ctx } = await freshDb();
    createUser(db, ctx, { name: "Admin", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
    const pipelineId = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const person = createPerson(db, ctx, { name: "Cliente" });
    createCard(db, ctx, { pipelineId, title: "Da Ana", personId: person, ownerId: ana });
    createCard(db, ctx, { pipelineId, title: "Da Bia", personId: person, ownerId: bia });
    expect(listCardsForEntity(db, { personId: person }).map((c) => c.title).sort()).toEqual(["Da Ana", "Da Bia"]);
    expect(listCardsForEntity(db, { personId: person }, { id: ana, role: "vendedor" }).map((c) => c.title)).toEqual(["Da Ana"]);
  });
});

describe("importação", () => {
  it("contatos: cria, liga organização pelo nome, preenche campo por nome e ignora duplicados", async () => {
    const { db, ctx } = await freshDb();
    const turma = createCustomField(db, ctx, { entity: "person", name: "Turma aluno", fieldType: "text" });
    createPerson(db, ctx, { name: "Já existe", email: "ja@x.com" });
    const r = importPersons(db, ctx, [
      { name: "Daniel", phone: "11 99999-1111", organizationName: "Colégio Motivo", customByName: { "Turma Aluno": "3º A" } },
      { name: "Cris", organizationName: "colégio motivo" },
      { name: "Repetido", email: "JA@x.com" },
      { name: "", email: "x@x.com" },
    ]);
    expect(r.created).toBe(2);
    expect(r.skipped).toEqual([{ row: 4, reason: "já existe: Já existe" }]);
    expect(r.errors.map((e) => e.row)).toEqual([5]);
    expect(countOrganizations(db)).toBe(1);
    const daniel = listPersons(db, { search: "Daniel" })[0]!;
    expect(daniel).toMatchObject({ phone: "+5511999991111", primary_organization_name: "Colégio Motivo" });
    expect(getPerson(db, daniel.id)!.customValues[turma]).toBe("3º A");
  });

  it("organizações: ignora CNPJ ou nome repetido", async () => {
    const { db, ctx } = await freshDb();
    createOrganization(db, ctx, { name: "ABMES", cnpj: "11222333000181" });
    const r = importOrganizations(db, ctx, [{ name: "Outra", cnpj: "11.222.333/0001-81" }, { name: "abmes" }, { name: "Nova" }]);
    expect(r.created).toBe(1);
    expect(r.skipped.map((s) => s.row)).toEqual([2, 3]);
  });
});

describe("consulta de CNPJ e CEP", () => {
  const brasilApi = {
    cnpj: "11222333000181",
    razao_social: "ASSOCIACAO BRASILEIRA",
    nome_fantasia: "",
    cnae_fiscal: 8599699,
    cnae_fiscal_descricao: "Outras atividades de ensino",
    descricao_tipo_de_logradouro: "RUA",
    logradouro: "DAS FLORES",
    numero: "10",
    bairro: "CENTRO",
    municipio: "BRASILIA",
    uf: "DF",
    cep: "70000000",
    ddd_telefone_1: "6133334444",
    qsa: [{ nome_socio: "FULANO", qualificacao_socio: "Diretor" }],
  };
  const receitaWs = { nome: "ASSOCIACAO BRASILEIRA", fantasia: "ABMES", email: "CONTATO@ABMES.ORG.BR", qsa: [{ nome: "FULANO", qual: "Diretor" }, { nome: "CICLANO", qual: "Sócio" }] };

  it("combina as fontes e gera os campos da organização", () => {
    const merged = mergeCnpjData([normalizeBrasilApi(brasilApi), normalizeReceitaWs(receitaWs)]);
    expect(merged.nomeFantasia).toBe("ABMES");
    expect(merged.qsa.map((s) => s.nome)).toEqual(["CICLANO", "FULANO"]);
    expect(cnpjToOrganizationFields(merged)).toMatchObject({
      name: "ABMES",
      legalName: "ASSOCIACAO BRASILEIRA",
      segment: "Outras atividades de ensino",
      phone: "(61) 3333-4444",
      email: "contato@abmes.org.br",
      street: "RUA DAS FLORES",
      cep: "70000000",
      state: "DF",
    });
  });

  it("consulta em paralelo e aceita fonte fora do ar", async () => {
    const fake = (async (url: string) => {
      if (url.includes("brasilapi")) return { ok: true, status: 200, json: async () => brasilApi } as Response;
      if (url.includes("receitaws")) return { ok: true, status: 200, json: async () => receitaWs } as Response;
      throw new Error("offline");
    }) as typeof fetch;
    const r = await lookupCnpj("11.222.333/0001-81", fake);
    expect(r.ok && r.sources).toEqual(["BrasilAPI", "ReceitaWS"]);
    expect(await lookupCnpj("11.222.333/0001-82", fake)).toEqual({ ok: false, error: "CNPJ inválido. Informe 14 dígitos válidos." });
  });

  it("CEP: BrasilAPI e, se falhar, ViaCEP", async () => {
    const fake = (async (url: string) => {
      if (url.includes("brasilapi")) return { ok: false, status: 404, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({ logradouro: "Rua Imaculada Conceição", bairro: "Prado Velho", localidade: "Curitiba", uf: "PR" }) } as Response;
    }) as typeof fetch;
    expect(await lookupCep("80215-901", fake)).toEqual({ street: "Rua Imaculada Conceição", district: "Prado Velho", city: "Curitiba", state: "PR" });
    expect(await lookupCep("123", fake)).toBeNull();
  });
});

describe("CSV com acentos", () => {
  it("lê UTF-8 (com BOM) e Windows-1252", async () => {
    const { decodeCsv } = await import("../src/lib/spreadsheet");
    const utf8 = new TextEncoder().encode("﻿Nome\nColégio");
    expect(decodeCsv(utf8.buffer as ArrayBuffer)).toBe("Nome\nColégio");
    const latin1 = new Uint8Array([0x43, 0x6f, 0x6c, 0xe9, 0x67, 0x69, 0x6f]); // "Colégio" em Windows-1252
    expect(decodeCsv(latin1.buffer)).toBe("Colégio");
  });
});
