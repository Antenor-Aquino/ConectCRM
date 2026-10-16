import { describe, expect, it } from "vitest";
import { createPerson } from "../src/db/contacts";
import { createCustomField, customFieldUsage, listCustomFields, reorderCustomFields } from "../src/db/customFields";
import { createCard, setDealItems } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { createProduct, productUsage } from "../src/db/products";
import { createTag, tagUsage } from "../src/db/tags";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb } from "./helpers";

describe("uso antes de excluir", () => {
  it("conta valores de campo, tags e produtos em uso", async () => {
    const { db, ctx } = await freshDb();
    const cargo = createCustomField(db, ctx, { entity: "person", name: "Cargo", fieldType: "text" });
    const vip = createTag(db, ctx, { entity: "person", name: "VIP" });
    createPerson(db, ctx, { name: "A", tagIds: [vip], customValues: { [cargo]: "Diretor" } });
    createPerson(db, ctx, { name: "B", tagIds: [vip] });
    expect(customFieldUsage(db, cargo)).toBe(1);
    expect(tagUsage(db, "person")).toEqual({ [vip]: 2 });
    const pipelineId = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }] });
    const lic = createProduct(db, ctx, { name: "Licença", kind: "servico", priceCents: 1000 });
    setDealItems(db, ctx, createCard(db, ctx, { pipelineId, title: "X" }), [{ productId: lic }]);
    expect(productUsage(db)).toEqual({ [lic]: 1 });
  });

  it("reordena campos", async () => {
    const { db, ctx } = await freshDb();
    const a = createCustomField(db, ctx, { entity: "person", name: "A", fieldType: "text" });
    const b = createCustomField(db, ctx, { entity: "person", name: "B", fieldType: "text" });
    reorderCustomFields(db, ctx, [b, a]);
    expect(listCustomFields(db, "person").map((f) => f.name)).toEqual(["B", "A"]);
  });
});

describe("permissões das configurações", () => {
  it("campos e edição de tags: só administrador; produtos: administrador e gestor; criar tag e motivo: todos", async () => {
    const { db, ctx } = await freshDb();
    const admin = { ...ctx, userId: createUser(db, ctx, { name: "Admin", role: "admin" }) };
    const gestor = { ...ctx, userId: createUser(db, ctx, { name: "Gestor", role: "gestor" }) };
    const vend = { ...ctx, userId: createUser(db, ctx, { name: "Vend", role: "vendedor" }) };
    expect(() => methods["customFields.create"](db, gestor, { entity: "person", name: "X", fieldType: "text" })).toThrow(/Sem permissão/);
    expect(methods["customFields.create"](db, admin, { entity: "person", name: "X", fieldType: "text" })).toBeTruthy();
    expect(() => methods["products.create"](db, vend, { name: "P", kind: "produto" })).toThrow(/Sem permissão/);
    expect(methods["products.create"](db, gestor, { name: "P", kind: "produto" })).toBeTruthy();
    const tag = methods["tags.create"](db, vend, { entity: "person", name: "Nova" });
    expect(() => methods["tags.delete"](db, vend, { id: tag })).toThrow(/Sem permissão/);
    expect(methods["lossReasons.create"](db, vend, { name: "Preço" })).toBeTruthy();
  });
});
