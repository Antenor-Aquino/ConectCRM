import { describe, expect, it } from "vitest";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCustomField, listCustomFields } from "../src/db/customFields";
import { createCard, getBoard, getCard, updateCard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createTag } from "../src/db/tags";
import { createUser } from "../src/db/users";
import { isEditableListKey, toPatch } from "../src/dashboard/board/ListCellEditor";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx } = await freshDb();
  const me = createUser(db, ctx, { name: "Antenor", role: "admin" });
  const c = { ...ctx, userId: me };
  const pipelineId = createPipeline(db, c, { name: "PowerCubus", type: "comercial", stages: [{ name: "Prospect" }] });
  return { db, ctx: c, pipelineId };
}

describe("pesquisa do quadro em qualquer dado do cartão", () => {
  it("acha por campo personalizado, opção da lista, tag, e-mail, CNPJ e telefone", async () => {
    const { db, ctx, pipelineId } = await setup();
    const plano = createCustomField(db, ctx, { entity: "deal", name: "Plano", fieldType: "select", options: [{ label: "Premium" }, { label: "Pro" }] });
    const turmas = createCustomField(db, ctx, { entity: "deal", name: "Unidades", fieldType: "text" });
    const premium = listCustomFields(db, "deal").find((f) => f.id === plano)!.options.find((o) => o.label === "Premium")!.id;
    const tag = createTag(db, ctx, { entity: "deal", name: "Renovação" });
    const person = createPerson(db, ctx, { name: "Lívia", email: "livia@colegio.com.br", phone: "+5531988887777" });
    const org = createOrganization(db, ctx, { name: "Sagrado", cnpj: "17366932000155" });
    const a = createCard(db, ctx, { pipelineId, title: "Colégio A", personId: person, organizationId: org });
    const b = createCard(db, ctx, { pipelineId, title: "Colégio B", description: "Ligar depois da licitação" });
    updateCard(db, ctx, a, { customValues: { [plano]: premium, [turmas]: "CNSA Araçatuba 15" }, tagIds: [tag] });

    const found = (search: string) => getBoard(db, pipelineId, { search }).flatMap((c) => c.cards.map((x) => x.title)).sort();
    expect(found("Premium")).toEqual(["Colégio A"]);
    expect(found("Araçatuba")).toEqual(["Colégio A"]);
    expect(found("Renova")).toEqual(["Colégio A"]);
    expect(found("livia@colegio")).toEqual(["Colégio A"]);
    expect(found("17.366.932")).toEqual(["Colégio A"]);
    expect(found("98888-7777")).toEqual(["Colégio A"]);
    expect(found("licitação")).toEqual(["Colégio B"]);
    expect(found("Colégio")).toEqual(["Colégio A", "Colégio B"]);
    expect(found("nada disso")).toEqual([]);
    expect(getCard(db, b)).toBeTruthy();
  });
});

describe("edição na lista", () => {
  it("colunas editáveis e o patch gravado", async () => {
    expect(["valor", "tags", "etapa", "responsavel", "previsao_fechamento", "cf:abc"].every(isEditableListKey)).toBe(true);
    expect(["contato", "organizacao", "proxima_tarefa", "pcf:x", "ocf:y", "criado_em"].some(isEditableListKey)).toBe(false);
    expect(toPatch("valor", 129077)).toEqual({ valueCents: 129077 });
    expect(toPatch("tags", ["t1"])).toEqual({ tagIds: ["t1"] });
    expect(toPatch("cf:x1", "Premium", "x1")).toEqual({ customValues: { x1: "Premium" } });
    expect(toPatch("previsao_fechamento", "")).toEqual({ expectedCloseAt: null });

    const { db, ctx, pipelineId } = await setup();
    const id = createCard(db, ctx, { pipelineId, title: "X" });
    updateCard(db, ctx, id, toPatch("valor", 50000) as never);
    updateCard(db, ctx, id, toPatch("previsao_fechamento", "2026-12-15") as never);
    expect(getCard(db, id)).toMatchObject({ value_cents: 50000 });
    expect(getCard(db, id)!.expected_close_at).toMatch(/^2026-12-15/);
  });
});
