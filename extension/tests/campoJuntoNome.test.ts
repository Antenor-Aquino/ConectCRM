// Campo personalizado exibido junto com o nome (até 2 por cadastro):
// "Maria José - Diretora", "AEB Sistemas - Saúde", no título do cartão, na atividade e no produto.
import { describe, expect, it } from "vitest";
import { createActivity, listActivities } from "../src/db/activities";
import { createOrganization, createPerson, getOrganization, getPerson, listOrganizations, listPersons } from "../src/db/contacts";
import { createCustomField, setCustomValues, updateCustomField, listCustomFields } from "../src/db/customFields";
import { createCard, getBoard, getCard } from "../src/db/deals";
import { cardFieldValues } from "../src/db/cardFieldValues";
import { createPipeline } from "../src/db/pipelines";
import { createProduct, listProducts } from "../src/db/products";
import { nameExtras } from "../src/db/nameExtras";
import { freshDb } from "./helpers";

describe("campo junto com o nome", () => {
  it("no máximo 2 por cadastro; marcar e desmarcar", async () => {
    const { db, ctx } = await freshDb();
    const cargo = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text", showWithName: true });
    createCustomField(db, ctx, { entity: "person", name: "Setor", fieldType: "text", showWithName: true });
    expect(() => createCustomField(db, ctx, { entity: "person", name: "Apelido", fieldType: "text", showWithName: true })).toThrow(/No máximo 2 .*Cargo e Setor/);
    const apelido = createCustomField(db, ctx, { entity: "person", name: "Apelido", fieldType: "text" });
    expect(() => updateCustomField(db, ctx, apelido, { showWithName: true })).toThrow(/No máximo 2/);
    // Outra entidade não conta.
    createCustomField(db, ctx, { entity: "organization", name: "Área", fieldType: "text", showWithName: true });
    updateCustomField(db, ctx, cargo, { showWithName: false });
    updateCustomField(db, ctx, apelido, { showWithName: true });
    updateCustomField(db, ctx, apelido, { showWithName: true, name: "Apelido " }); // já marcado: não conta duas vezes
    expect(listCustomFields(db, "person").filter((f) => f.show_with_name).map((f) => f.name)).toEqual(["Setor", "Apelido"]);
  });

  it("formata os valores e aparece nas listas, no cartão, no quadro, nas atividades e nos produtos", async () => {
    const { db, ctx } = await freshDb();
    const cargo = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text", showWithName: true });
    const decisor = createCustomField(db, ctx, { entity: "person", name: "Decisor", fieldType: "boolean", showWithName: true });
    const area = createCustomField(db, ctx, { entity: "organization", name: "Área", fieldType: "select", options: [{ label: "Saúde" }, { label: "Educação" }], showWithName: true });
    const saude = listCustomFields(db, "organization")[0]!.options[0]!.id;
    const edital = createCustomField(db, ctx, { entity: "deal", name: "Edital", fieldType: "text", showWithName: true });
    const tipo = createCustomField(db, ctx, { entity: "activity", name: "Canal", fieldType: "text", showWithName: true });
    const linha = createCustomField(db, ctx, { entity: "product", name: "Linha", fieldType: "text", showWithName: true });
    createCustomField(db, ctx, { entity: "person", name: "Observação", fieldType: "text" }); // não marcado

    const maria = createPerson(db, ctx, { name: "Maria José", customValues: { [cargo]: "Diretora", [decisor]: true } });
    const joao = createPerson(db, ctx, { name: "João" });
    const aeb = createOrganization(db, ctx, { name: "AEB Sistemas", customValues: { [area]: saude } });
    expect(nameExtras(db, "person", [maria, joao]).get(maria)).toBe("Diretora · Decisor");
    expect(nameExtras(db, "person", [maria, joao]).has(joao)).toBe(false);
    expect(listPersons(db, {}).map((p) => [p.name, p.name_ext])).toEqual([["João", null], ["Maria José", "Diretora · Decisor"]]);
    expect(getPerson(db, maria)).toMatchObject({ name: "Maria José", name_ext: "Diretora · Decisor" }); // o nome em si não muda (edição)
    expect(listOrganizations(db, {})[0]).toMatchObject({ name: "AEB Sistemas", name_ext: "Saúde" });
    setCustomValues(db, ctx, "person", maria, { [decisor]: false });
    expect(getOrganization(db, aeb)!.name_ext).toBe("Saúde");

    const pl = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Proposta" }] });
    const stage = db.exec(`SELECT id FROM stage WHERE pipeline_id = '${pl}'`)[0]!.values[0]![0] as string;
    const card = createCard(db, ctx, { pipelineId: pl, stageId: stage, title: "Licença", personId: maria, organizationId: aeb, customValues: { [edital]: "PE 12/2026" } });
    expect(getCard(db, card)).toMatchObject({ title: "Licença", title_ext: "PE 12/2026", person_name: "Maria José - Diretora", organization_name: "AEB Sistemas - Saúde" });
    expect(getCard(db, card)!.contacts[0]).toMatchObject({ name: "Maria José", name_ext: "Diretora" });
    const b = getBoard(db, pl, {})[0]!.cards[0]!;
    expect(b).toMatchObject({ title: "Licença", title_ext: "PE 12/2026", person_name: "Maria José - Diretora", organization_name: "AEB Sistemas - Saúde" });
    const fv = cardFieldValues(db, pl, [card], { keys: ["contato", "organizacao"] }).values.get(card)!;
    expect(JSON.stringify(fv)).toMatch(/Maria José - Diretora/);
    expect(JSON.stringify(fv)).toMatch(/AEB Sistemas - Saúde/);

    const act = createActivity(db, ctx, { title: "Ligar", dealId: card, personId: maria, customValues: { [tipo]: "WhatsApp" } } as Parameters<typeof createActivity>[2]);
    expect(listActivities(db, { dealId: card }).find((a) => a.id === act)).toMatchObject({ title: "Ligar", title_ext: "WhatsApp", person_name: "Maria José - Diretora" });

    const prod = createProduct(db, ctx, { name: "Grade horária", kind: "servico", priceCents: 1000, customValues: { [linha]: "Escolas" } });
    expect(listProducts(db).find((p) => p.id === prod)).toMatchObject({ name: "Grade horária", name_ext: "Escolas" });
  });
});
