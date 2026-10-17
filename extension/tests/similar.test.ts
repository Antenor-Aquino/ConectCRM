import { describe, expect, it } from "vitest";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCard, setCardStatus } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { similarCards, similarOrganizations, similarPersons } from "../src/db/similar";
import { createUser } from "../src/db/users";
import { isSimilar, nameSimilarity } from "../src/lib/similarity";
import { freshDb } from "./helpers";

const pct = (a: string, b: string) => Math.round(nameSimilarity(a, b) * 100);

describe("nomes parecidos (> 70% em alguma parte do texto)", () => {
  it("pedaço do nome, sem acento, em qualquer ordem", () => {
    expect(pct("Anten", "Antenor Aquino")).toBe(71);
    expect(isSimilar(nameSimilarity("Anten", "Antenor Aquino"))).toBe(true);
    expect(isSimilar(nameSimilarity("Ante", "Antenor Aquino"))).toBe(false);
    expect(isSimilar(nameSimilarity("antenor aquno", "Antenor Aquino"))).toBe(true); // erro de digitação
    expect(isSimilar(nameSimilarity("Aquino Antenor", "Antenor Aquino"))).toBe(true);
    expect(isSimilar(nameSimilarity("JOAO", "João da Silva"))).toBe(true);
    expect(isSimilar(nameSimilarity("Antenor Aquino Filho", "Antenor Aquino"))).toBe(true);
    expect(isSimilar(nameSimilarity("Stepple Ltda", "Stepple"))).toBe(true);
  });

  it("não alerta nomes diferentes nem textos curtos", () => {
    expect(isSimilar(nameSimilarity("Maria Silva", "João Silva"))).toBe(false);
    expect(isSimilar(nameSimilarity("An", "Antenor Aquino"))).toBe(false);
    expect(isSimilar(nameSimilarity("Carlos", "Antenor Aquino"))).toBe(false);
  });

  it("contatos: respeita privados e o próprio registro; traz detalhes", async () => {
    const { db, ctx } = await freshDb();
    const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const org = createOrganization(db, ctx, { name: "Stepple" });
    const antenor = createPerson(db, ctx, { name: "Antenor Aquino", email: "antenor@x.com.br", organizationIds: [org] });
    createPerson(db, ctx, { name: "Antenor Privado", isPrivate: true, ownerId: admin });
    const r = similarPersons(db, { name: "Anten" }, { id: ana, role: "vendedor" });
    expect(r.map((x) => x.name)).toEqual(["Antenor Aquino"]);
    expect(r[0]).toMatchObject({ id: antenor, score: 71, details: ["Stepple", "antenor@x.com.br"] });
    expect(similarPersons(db, { name: "Anten" }, { id: admin, role: "admin" })).toHaveLength(2);
    expect(similarPersons(db, { name: "Antenor Aquino", excludeId: antenor }, null)).toHaveLength(0);
  });

  it("organizações: nome fantasia ou razão social", async () => {
    const { db, ctx } = await freshDb();
    createOrganization(db, ctx, { name: "PowerCubus", legalName: "Power Cubus Tecnologia Ltda" });
    expect(similarOrganizations(db, { name: "Powercubos" })[0]).toMatchObject({ name: "PowerCubus" });
    expect(similarOrganizations(db, { name: "Power Cubus" })[0]).toMatchObject({ name: "PowerCubus", score: 100 });
  });

  it("cartões: título parecido no mesmo tipo e cartão em aberto do mesmo contato", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Novo" }] });
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const person = createPerson(db, ctx, { name: "Mari" });
    createCard(db, ctx, { pipelineId: vendas, title: "Implantação PUC-PR" });
    createCard(db, ctx, { pipelineId: suporte, title: "Implantação PUC-PR" });
    const aberto = createCard(db, ctx, { pipelineId: vendas, title: "Renovação", personId: person });
    const ganho = createCard(db, ctx, { pipelineId: vendas, title: "Consultoria", personId: person });
    setCardStatus(db, ctx, ganho, { status: "won" });
    const r = similarCards(db, { title: "Implantacao PUC", kind: "deal", personId: person }, null);
    expect(r.map((x) => [x.name, x.reason])).toEqual([
      ["Implantação PUC-PR", "title"],
      ["Renovação", "person"],
    ]);
    expect(r[1]).toMatchObject({ id: aberto, details: ["Vendas › Novo", "Em aberto", "Mari"] });
  });
});
