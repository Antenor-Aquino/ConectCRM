import { describe, expect, it } from "vitest";
import { createCustomField, updateCustomField } from "../src/db/customFields";
import { createCard, getCard, updateCard } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createUser } from "../src/db/users";
import { freshDb } from "./helpers";

describe("Salvar campos personalizados do cartão", () => {
  it("grava mesmo com valor antigo de campo que deixou de valer para o funil ou foi desativado", async () => {
    const { db, ctx: base } = await freshDb();
    const ctx = { ...base, userId: createUser(db, base, { name: "Antenor", role: "admin" }) };
    const gestao = createPipeline(db, ctx, { name: "Gestão MG", type: "comercial", stages: [{ name: "A" }] });
    const outro = createPipeline(db, ctx, { name: "Outro", type: "comercial", stages: [{ name: "A" }] });
    const plano = createCustomField(db, ctx, { entity: "deal", name: "Plano", fieldType: "text" });
    const turmas = createCustomField(db, ctx, { entity: "deal", name: "Qtd Turmas", fieldType: "number" });
    const antigo = createCustomField(db, ctx, { entity: "deal", name: "Antigo", fieldType: "text" });
    const inativo = createCustomField(db, ctx, { entity: "deal", name: "Inativo", fieldType: "text" });
    const card = createCard(db, ctx, { pipelineId: gestao, title: "Escola" });
    updateCard(db, ctx, card, { customValues: { [antigo]: "x", [inativo]: "y" } });
    // Depois: "Antigo" passa a valer só no outro funil e "Inativo" é desativado.
    updateCustomField(db, ctx, antigo, { pipelineIds: [outro] });
    updateCustomField(db, ctx, inativo, { active: false });

    // A tela manda tudo o que o cartão tem (inclusive os antigos, sem mudança).
    const all = { ...getCard(db, card)!.customValues, [plano]: "Premium", [turmas]: 114 };
    updateCard(db, ctx, card, { customValues: all });
    expect(getCard(db, card)!.customValues).toMatchObject({ [plano]: "Premium", [turmas]: 114, [antigo]: "x" });
    // Mudar o valor de um campo que não vale para o funil continua recusado.
    expect(() => updateCard(db, ctx, card, { customValues: { [antigo]: "z" } })).toThrow(/não encontrado/);
  });
});
