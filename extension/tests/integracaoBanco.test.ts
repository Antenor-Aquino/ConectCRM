import { describe, expect, it } from "vitest";
import { getPerson, getOrganization, createPerson, createOrganization } from "../src/db/contacts";
import { createCustomField, getCustomValues, listCustomFields } from "../src/db/customFields";
import { getCardRow } from "../src/db/deals";
import { checkExternal, externalRefsOf, importExternalDeals, importExternalOrganizations, importExternalPersons } from "../src/db/externalImport";
import { createPipeline } from "../src/db/pipelines";
import { many, one } from "../src/db/sql";
import { getEntityTags } from "../src/db/tags";
import { freshDb } from "./helpers";

const P = "pipedrive" as const;

describe("integrações: vínculo com o registro de origem", () => {
  it("organização e contato: cria, vincula a organização e marca como já importado", async () => {
    const { db, ctx } = await freshDb();
    const o = importExternalOrganizations(db, ctx, {
      provider: P,
      rows: [
        {
          externalId: "10",
          label: "Colégio Alfa",
          name: "Colégio Alfa",
          city: "Curitiba",
          state: "PR",
          tags: ["Cliente"],
          sourceUpdatedAt: "2026-01-01T10:00:00Z",
        },
      ],
    });
    expect(o).toMatchObject({ created: 1, errors: [] });
    const p = importExternalPersons(db, ctx, {
      provider: P,
      rows: [{ externalId: "7", label: "Ana", name: "Ana Souza", email: "ana@alfa.com.br", phone: "(41) 99999-8888", organizationExternalId: "10" }],
    });
    expect(p).toMatchObject({ created: 1, errors: [] });
    const personId = one<{ id: string }>(db, "SELECT id FROM person")!.id;
    const person = getPerson(db, personId)!;
    expect([person.email, person.phone, person.organizations.map((o) => o.name)]).toEqual(["ana@alfa.com.br", "+5541999998888", ["Colégio Alfa"]]);
    expect(externalRefsOf(db, personId)).toEqual([expect.objectContaining({ provider: "pipedrive", entity: "person", externalId: "7" })]);

    const st = checkExternal(db, P, "organization", [
      { externalId: "10", name: "Colégio Alfa", updatedAt: "2026-01-01T10:00:00Z" },
      { externalId: "11", name: "colégio alfa" },
      { externalId: "12", name: "Outra" },
    ]);
    // 11 tem o mesmo nome, mas a organização local já está vinculada a 10: não é duplicado.
    expect(st.map((s) => s.status)).toEqual(["imported", "new", "new"]);
    expect(st[0]!.changed).toBe(false);
    expect(checkExternal(db, P, "organization", [{ externalId: "10", name: "x", updatedAt: "2026-02-01T00:00:00Z" }])[0]!.changed).toBe(true);
  });

  it("possível duplicado pelo e-mail/celular/nome; vincular sem alterar ou vincular e atualizar", async () => {
    const { db, ctx } = await freshDb();
    const local = createPerson(db, ctx, { name: "Bruno Lima", email: "bruno@x.com", notes: "do CRM" });
    const org = createOrganization(db, ctx, { name: "Beta SA", cnpj: "11.222.333/0001-81" });
    expect(checkExternal(db, P, "person", [{ externalId: "1", name: "B. Lima", email: "BRUNO@x.com" }])[0]).toMatchObject({
      status: "duplicate",
      localId: local,
      match: "email",
    });
    expect(checkExternal(db, P, "organization", [{ externalId: "9", name: "Beta", cnpj: "11222333000181" }])[0]).toMatchObject({
      status: "duplicate",
      localId: org,
      match: "cnpj",
    });

    const r = importExternalPersons(db, ctx, { provider: P, rows: [{ externalId: "1", label: "Bruno", localId: local, name: "Bruno Pipedrive" }] });
    expect(r).toMatchObject({ linked: 1, created: 0 });
    expect(getPerson(db, local)!.name).toBe("Bruno Lima");
    const u = importExternalPersons(db, ctx, {
      provider: P,
      rows: [{ externalId: "1", label: "Bruno", localId: local, update: true, name: "Bruno Pipedrive", phone: "", tags: ["VIP"] }],
    });
    expect(u).toMatchObject({ updated: 1 });
    const after = getPerson(db, local)!;
    // Campo vazio na origem não apaga o que o CRM tem.
    expect([after.name, after.email, after.notes]).toEqual(["Bruno Pipedrive", "bruno@x.com", "do CRM"]);
    expect(getEntityTags(db, local).map((t) => t.name)).toEqual(["VIP"]);
    expect(many(db, "SELECT id FROM external_ref WHERE deleted_at IS NULL")).toHaveLength(1);
  });

  it("dados inválidos ficam de fora com aviso; sem nome dá erro sem gravar o vínculo", async () => {
    const { db, ctx } = await freshDb();
    createOrganization(db, ctx, { name: "Dona do CNPJ", cnpj: "11222333000181" });
    const r = importExternalOrganizations(db, ctx, {
      provider: P,
      rows: [
        { externalId: "1", label: "Gama", name: "Gama", email: "não-é-email", cnpj: "11222333000181" },
        { externalId: "2", label: "(sem nome)", name: "" },
      ],
    });
    expect(r.created).toBe(1);
    expect(r.warnings[0]!.message).toMatch(/E-mail "não-é-email" inválido.*CNPJ já cadastrado em Dona do CNPJ/);
    expect(r.errors).toEqual([{ row: 2, message: "(sem nome): sem nome da organização." }]);
    expect(many(db, "SELECT external_id FROM external_ref").map((x) => (x as { external_id: string }).external_id)).toEqual(["1"]);
    const gama = one<{ id: string }>(db, "SELECT id FROM organization WHERE name = 'Gama'")!.id;
    expect(getOrganization(db, gama)!.email).toBeNull();
  });

  it("leads viram cartões no funil comercial, com contato, organização, valor e campos", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }, { name: "Proposta" }] });
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const stage = many<{ id: string }>(db, "SELECT id FROM stage WHERE pipeline_id = ? ORDER BY position", vendas)[1]!.id;
    createCustomField(db, ctx, { entity: "deal", name: "Canal", fieldType: "select", options: [{ label: "Site" }, { label: "Feira" }] });
    const canal = listCustomFields(db, "deal")[0]!;
    importExternalOrganizations(db, ctx, { provider: P, rows: [{ externalId: "10", label: "Alfa", name: "Alfa" }] });
    importExternalPersons(db, ctx, { provider: P, rows: [{ externalId: "7", label: "Ana", name: "Ana", organizationExternalId: "10" }] });
    expect(() => importExternalDeals(db, ctx, { provider: P, pipelineId: suporte, rows: [] })).toThrow(/funil comercial/);
    const r = importExternalDeals(db, ctx, {
      provider: P,
      pipelineId: vendas,
      stageId: stage,
      rows: [
        {
          externalId: "a1b2-uuid",
          label: "Lead Alfa",
          title: "Lead Alfa",
          value: "1500.5",
          expectedCloseAt: "2026-12-15",
          origin: "Site",
          personExternalId: "7",
          organizationExternalId: "10",
          tags: ["Quente"],
          custom: { [canal.id]: "feira" },
        },
      ],
    });
    expect(r).toMatchObject({ created: 1, errors: [] });
    const cardId = one<{ id: string }>(db, "SELECT id FROM deal")!.id;
    const card = getCardRow(db, cardId)!;
    expect([card.stage_id, card.value_cents, card.origin, card.kind]).toEqual([stage, 150050, "Site", "deal"]);
    expect(card.person_id).toBe(one<{ id: string }>(db, "SELECT id FROM person")!.id);
    expect(card.organization_id).toBe(one<{ id: string }>(db, "SELECT id FROM organization")!.id);
    expect(getCustomValues(db, cardId)[canal.id]).toBe(canal.options[1]!.id);
    // Atualizar: muda valor, mantém etapa.
    importExternalDeals(db, ctx, {
      provider: P,
      pipelineId: vendas,
      rows: [{ externalId: "a1b2-uuid", label: "Lead Alfa", localId: cardId, update: true, value: "2000" }],
    });
    expect([getCardRow(db, cardId)!.value_cents, getCardRow(db, cardId)!.stage_id]).toEqual([200000, stage]);
    expect(checkExternal(db, P, "deal", [{ externalId: "a1b2-uuid", name: "Lead Alfa" }])[0]!.status).toBe("imported");
  });
});
