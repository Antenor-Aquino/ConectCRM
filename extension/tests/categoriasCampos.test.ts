import { describe, expect, it } from "vitest";
import {
  createCustomField,
  createFieldGroup,
  deleteFieldGroup,
  listCustomFields,
  listFieldGroups,
  renameFieldGroup,
  reorderFieldGroups,
  updateCustomField,
} from "../src/db/customFields";
import { fieldGroups } from "../src/lib/fieldGroups";
import { freshDb } from "./helpers";

describe("categorias de campos personalizados", () => {
  it("cria, ordena, renomeia; campo leva a categoria; excluir deixa os campos sem categoria", async () => {
    const { db, ctx } = await freshDb();
    const prof = createFieldGroup(db, ctx, { entity: "person", name: "Dados profissionais" });
    const pess = createFieldGroup(db, ctx, { entity: "person", name: "Dados pessoais" });
    expect(() => createFieldGroup(db, ctx, { entity: "person", name: "dados PROFISSIONAIS" })).toThrow(/Já existe/);
    const org = createFieldGroup(db, ctx, { entity: "organization", name: "Fiscal" });
    const cargo = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text", groupId: prof });
    createCustomField(db, ctx, { entity: "person", name: "Nascimento", fieldType: "date", groupId: pess });
    createCustomField(db, ctx, { entity: "person", name: "Apelido", fieldType: "text" });
    expect(() => createCustomField(db, ctx, { entity: "person", name: "X", fieldType: "text", groupId: org })).toThrow(/outro tipo/);
    reorderFieldGroups(db, ctx, [pess, prof]);
    renameFieldGroup(db, ctx, prof, "Profissional");
    const fields = listCustomFields(db, "person");
    expect(fieldGroups(fields).map((g) => [g.name, g.fields.map((f) => f.name)])).toEqual([
      [null, ["Apelido"]],
      ["Dados pessoais", ["Nascimento"]],
      ["Profissional", ["Cargo"]],
    ]);
    expect(listFieldGroups(db, "person").map((g) => [g.name, g.field_count])).toEqual([
      ["Dados pessoais", 1],
      ["Profissional", 1],
    ]);
    updateCustomField(db, ctx, cargo, { groupId: null });
    deleteFieldGroup(db, ctx, pess);
    const after = listCustomFields(db, "person");
    expect(after.every((f) => f.group_id === null)).toBe(true);
    // Sem categorias, um grupo só (formulário como antes).
    expect(fieldGroups(after)).toHaveLength(1);
  });
});
