import { describe, expect, it } from "vitest";
import { createPerson, getPerson } from "../src/db/contacts";
import { createCustomField, getCustomValues, listCustomFields, setCustomValues, updateCustomField } from "../src/db/customFields";
import { createPipeline } from "../src/db/pipelines";
import { createTag, deleteTag, getEntityTags, listTags, setEntityTags } from "../src/db/tags";
import { freshDb } from "./helpers";

describe("tags por entidade", () => {
  it("cada entidade tem sua lista e nome não repete (sem diferenciar maiúsculas)", async () => {
    const { db, ctx } = await freshDb();
    createTag(db, ctx, { entity: "person", name: "VIP", color: "amber" });
    createTag(db, ctx, { entity: "deal", name: "VIP" });
    expect(() => createTag(db, ctx, { entity: "person", name: "vip" })).toThrow(/Já existe/);
    expect(() => createTag(db, ctx, { entity: "person", name: "X", color: "rosa" })).toThrow(/Cor/);
    expect(listTags(db, "person").map((t) => t.name)).toEqual(["VIP"]);
  });

  it("não aceita tag de outra entidade e remove vínculos ao excluir", async () => {
    const { db, ctx } = await freshDb();
    const personTag = createTag(db, ctx, { entity: "person", name: "Aluno" });
    const dealTag = createTag(db, ctx, { entity: "deal", name: "Quente" });
    const person = createPerson(db, ctx, { name: "Raquel", tagIds: [personTag] });
    expect(() => setEntityTags(db, ctx, "person", person, [dealTag])).toThrow(/outro tipo/);
    expect(getEntityTags(db, person).map((t) => t.name)).toEqual(["Aluno"]);
    deleteTag(db, ctx, personTag);
    expect(getEntityTags(db, person)).toEqual([]);
  });
});

describe("campos personalizados", () => {
  it("gera chave única a partir do nome e valida chave informada", async () => {
    const { db, ctx } = await freshDb();
    const a = createCustomField(db, ctx, { entity: "person", name: "Turma aluno", fieldType: "text" });
    const b = createCustomField(db, ctx, { entity: "organization", name: "Turma aluno", fieldType: "text" });
    const keys = [...listCustomFields(db, "person"), ...listCustomFields(db, "organization")].map((f) => [f.id, f.placeholder_key]);
    expect(keys).toEqual([[a, "turma_aluno"], [b, "turma_aluno_2"]]);
    expect(() => createCustomField(db, ctx, { entity: "person", name: "X", fieldType: "text", placeholderKey: "{{turma_aluno}}" })).toThrow(/já está em uso/);
    expect(() => createCustomField(db, ctx, { entity: "person", name: "X", fieldType: "text", placeholderKey: "Com Espaço" })).toThrow(/Chave reservada inválida/);
    const c = createCustomField(db, ctx, { entity: "person", name: "Origem", fieldType: "text", placeholderKey: "{{origem_lead}}" });
    expect(listCustomFields(db, "person").find((f) => f.id === c)!.placeholder_key).toBe("origem_lead");
  });

  it("valida e converte valores por tipo", async () => {
    const { db, ctx } = await freshDb();
    const person = createPerson(db, ctx, { name: "Cris" });
    const num = createCustomField(db, ctx, { entity: "person", name: "Filhos", fieldType: "number" });
    const date = createCustomField(db, ctx, { entity: "person", name: "Nascimento", fieldType: "date" });
    const yes = createCustomField(db, ctx, { entity: "person", name: "Ex-aluno", fieldType: "boolean" });
    const list = createCustomField(db, ctx, {
      entity: "person",
      name: "Origem do Lead",
      fieldType: "multiselect",
      options: [{ label: "Instagram" }, { label: "Indicação" }],
    });
    const opts = listCustomFields(db, "person").find((f) => f.id === list)!.options;
    setCustomValues(db, ctx, "person", person, { [num]: "2", [date]: "1990-05-10", [yes]: true, [list]: [opts[1]!.id] });
    expect(getCustomValues(db, person)).toEqual({ [num]: 2, [date]: "1990-05-10", [yes]: true, [list]: [opts[1]!.id] });
    expect(() => setCustomValues(db, ctx, "person", person, { [date]: "10/05/1990" })).toThrow(/data inválida/);
    expect(() => setCustomValues(db, ctx, "person", person, { [list]: ["nao-existe"] })).toThrow(/opção inválida/);
    setCustomValues(db, ctx, "person", person, { [num]: null });
    expect(getCustomValues(db, person)[num]).toBeUndefined();
  });

  it("obrigatório impede salvar; escondido não é exigido", async () => {
    const { db, ctx } = await freshDb();
    const req = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text", required: true });
    createCustomField(db, ctx, { entity: "person", name: "Interno", fieldType: "text", required: true, hidden: true });
    expect(() => createPerson(db, ctx, { name: "Sem cargo" })).toThrow(/obrigatórios: Cargo\./);
    const id = createPerson(db, ctx, { name: "Com cargo", customValues: { [req]: "Diretora" } });
    expect(getPerson(db, id)!.customValues).toEqual({ [req]: "Diretora" });
  });

  it("campo restrito a funil só vale naquele funil, e só funil do mesmo tipo", async () => {
    const { db, ctx } = await freshDb();
    const matriculas = createPipeline(db, ctx, { name: "Matrículas 2024", type: "comercial", stages: [{ name: "A" }] });
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "A" }] });
    const curso = createCustomField(db, ctx, { entity: "deal", name: "Curso", fieldType: "text", pipelineIds: [matriculas] });
    createCustomField(db, ctx, { entity: "deal", name: "Geral", fieldType: "text" });
    expect(listCustomFields(db, "deal", { pipelineId: matriculas }).map((f) => f.name)).toEqual(["Curso", "Geral"]);
    expect(listCustomFields(db, "deal", { pipelineId: vendas }).map((f) => f.name)).toEqual(["Geral"]);
    expect(() => updateCustomField(db, ctx, curso, { pipelineIds: [suporte] })).toThrow(/outro tipo/);
    expect(() => createCustomField(db, ctx, { entity: "person", name: "X", fieldType: "text", pipelineIds: [vendas] })).toThrow(/Só campos de negócio/);
  });

  it("listas exigem opções e opções podem ser editadas mantendo ids", async () => {
    const { db, ctx } = await freshDb();
    expect(() => createCustomField(db, ctx, { entity: "person", name: "Turma", fieldType: "select" })).toThrow(/ao menos uma opção/);
    const id = createCustomField(db, ctx, { entity: "person", name: "Turma", fieldType: "select", options: [{ label: "A" }, { label: "B" }] });
    const [a] = listCustomFields(db, "person")[0]!.options;
    updateCustomField(db, ctx, id, { options: [{ id: a!.id, label: "Turma A" }, { label: "C" }] });
    const options = listCustomFields(db, "person")[0]!.options;
    expect(options.map((o) => o.label)).toEqual(["Turma A", "C"]);
    expect(options[0]!.id).toBe(a!.id);
  });
});
