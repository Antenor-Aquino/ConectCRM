import { describe, expect, it } from "vitest";
import { assertCanAssign, canAccessCard, createCard, getBoard, getCard } from "../src/db/deals";
import { createPipeline, listStages } from "../src/db/pipelines";
import { saveStages } from "../src/db/stages";
import { createTeam, createUser } from "../src/db/users";
import { freshDb } from "./helpers";

async function setup() {
  const { db, ctx } = await freshDb();
  const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
  const gestor = createUser(db, ctx, { name: "Gestor", role: "gestor" });
  const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
  const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
  createTeam(db, ctx, { name: "Time SP", members: [{ userId: gestor, isLeader: true }, { userId: ana }] });
  const pipelineId = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "A" }, { name: "B" }] });
  const cards = {
    ana: createCard(db, ctx, { pipelineId, title: "Da Ana", ownerId: ana }),
    bia: createCard(db, ctx, { pipelineId, title: "Da Bia", ownerId: bia }),
    none: createCard(db, ctx, { pipelineId, title: "Sem responsável", ownerId: null }),
  };
  return { db, ctx, pipelineId, cards, v: {
    admin: { id: admin, role: "admin" as const },
    gestor: { id: gestor, role: "gestor" as const },
    ana: { id: ana, role: "vendedor" as const },
    bia: { id: bia, role: "vendedor" as const },
  } };
}

const titles = (cols: ReturnType<typeof getBoard>) => cols.flatMap((c) => c.cards.map((x) => x.title)).sort();

describe("permissão por tipo de usuário", () => {
  it("administrador vê tudo; gestor vê a equipe; vendedor só os seus (e os sem responsável)", async () => {
    const { db, pipelineId, v } = await setup();
    expect(titles(getBoard(db, pipelineId, { viewer: v.admin }))).toEqual(["Da Ana", "Da Bia", "Sem responsável"]);
    expect(titles(getBoard(db, pipelineId, { viewer: v.gestor }))).toEqual(["Da Ana", "Sem responsável"]);
    expect(titles(getBoard(db, pipelineId, { viewer: v.ana }))).toEqual(["Da Ana", "Sem responsável"]);
    expect(titles(getBoard(db, pipelineId, { viewer: v.bia }))).toEqual(["Da Bia", "Sem responsável"]);
  });

  it("detalhe e edição respeitam a mesma regra", async () => {
    const { db, cards, v } = await setup();
    expect(getCard(db, cards.bia, v.ana)).toBeUndefined();
    expect(getCard(db, cards.bia, v.admin)).toBeDefined();
    expect(canAccessCard(db, v.gestor, cards.ana)).toBe(true);
    expect(canAccessCard(db, v.gestor, cards.bia)).toBe(false);
  });

  it("vendedor só atribui a si; gestor só à equipe", async () => {
    const { db, v } = await setup();
    expect(() => assertCanAssign(db, v.ana, v.bia.id)).toThrow(/a si mesmo/);
    expect(() => assertCanAssign(db, v.ana, v.ana.id)).not.toThrow();
    expect(() => assertCanAssign(db, v.gestor, v.ana.id)).not.toThrow();
    expect(() => assertCanAssign(db, v.gestor, v.bia.id)).toThrow(/sua equipe/);
    expect(() => assertCanAssign(db, v.admin, v.bia.id)).not.toThrow();
  });
});

describe("edição de etapas", () => {
  it("renomeia, reordena, adiciona e exclui movendo os cartões", async () => {
    const { db, ctx, pipelineId, cards } = await setup();
    const [a, b] = listStages(db, pipelineId);
    expect(() => saveStages(db, ctx, pipelineId, [{ id: b!.id, name: "B" }])).toThrow(/tem cartões/);
    saveStages(db, ctx, pipelineId, [{ id: b!.id, name: "Contato", color: "purple" }, { name: "Proposta", probability: 60 }], { [a!.id]: b!.id });
    expect(listStages(db, pipelineId).map((s) => [s.name, s.color, s.probability])).toEqual([["Contato", "purple", null], ["Proposta", null, 60]]);
    expect(getCard(db, cards.ana)!.stage_id).toBe(b!.id);
    expect(() => saveStages(db, ctx, pipelineId, [])).toThrow(/pelo menos uma etapa/);
  });
});
