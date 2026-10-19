import { describe, expect, it } from "vitest";
import { createActivity, deleteActivity, listActivities } from "../src/db/activities";
import { bulkCards } from "../src/db/bulkCards";
import { createPerson, createOrganization, deletePerson, linkPersonOrganization } from "../src/db/contacts";
import { createCard, deleteCard, getCard } from "../src/db/deals";
import { addNote } from "../src/db/notes";
import { createPipeline, deletePipeline } from "../src/db/pipelines";
import { many, one } from "../src/db/sql";
import { saveStages } from "../src/db/stages";
import { createTag, deleteTag, getEntityTags, setEntityTags } from "../src/db/tags";
import { expiredTrashIds, listTrash, purgeTrash, restoreTrashItem, retentionDays, setRetentionDays, trashCount } from "../src/db/trash";
import { createUser, getViewer } from "../src/db/users";
import { freshDb } from "./helpers";

const noDocs = () => [];

async function setup() {
  const { db, ctx } = await freshDb();
  const admin = createUser(db, ctx, { name: "Admin", role: "admin" });
  const bia = createUser(db, ctx, { name: "Bia", role: "vendedor" });
  const actx = { ...ctx, userId: admin };
  const bctx = { ...ctx, userId: bia };
  const vendas = createPipeline(db, actx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }, { name: "Proposta" }] });
  return { db, actx, bctx, admin, bia, vendas, va: getViewer(db, admin), vb: getViewer(db, bia) };
}

describe("lixeira", () => {
  it("cartão vai para a lixeira com as atividades e notas e volta inteiro", async () => {
    const { db, actx, vendas, va } = await setup();
    const card = createCard(db, actx, { pipelineId: vendas, title: "Escola Alfa" });
    const act = createActivity(db, actx, { title: "Ligar", dueAt: "2026-11-02T13:00:00.000Z", dealId: card });
    addNote(db, actx, "deal", card, "<p>Pediu proposta</p>");
    const notice = deleteCard(db, actx, card);
    expect(notice).toMatchObject({ __trash: true, label: "Negócio “Escola Alfa”", days: 30 });
    expect(getCard(db, card)).toBeUndefined();
    expect(listActivities(db, {}).map((a) => a.id)).not.toContain(act);
    const [item] = listTrash(db, va);
    expect(item).toMatchObject({ entity: "deal", title: "Escola Alfa", detail: "Negócio · Funil Vendas", deleted_by_name: "Admin", related: 2 });
    expect(new Date(item!.expires_at).getTime() - new Date(item!.deleted_at).getTime()).toBe(30 * 86400_000);
    restoreTrashItem(db, actx, va, item!.id);
    expect(getCard(db, card)?.title).toBe("Escola Alfa");
    expect(listActivities(db, {}).map((a) => a.id)).toContain(act);
    expect(one(db, "SELECT 1 FROM note WHERE entity_id = ? AND deleted_at IS NULL", card)).toBeTruthy();
    expect(trashCount(db, va)).toBe(0);
  });

  it("exclusão definitiva tira as linhas do banco (e o histórico) e solta os vínculos", async () => {
    const { db, actx, vendas, va } = await setup();
    const ana = createPerson(db, actx, { name: "Ana" });
    const org = createOrganization(db, actx, { name: "Colégio" });
    linkPersonOrganization(db, actx, ana, org);
    const card = createCard(db, actx, { pipelineId: vendas, title: "Escola", personId: ana });
    const vip = createTag(db, actx, { entity: "person", name: "VIP" });
    setEntityTags(db, actx, "person", ana, [vip]);
    addNote(db, actx, "person", ana, "<p>Mãe do aluno</p>");
    deletePerson(db, actx, ana);
    const [item] = listTrash(db, va);
    expect(purgeTrash(db, actx, [item!.id], noDocs)).toEqual({ purged: 1, orphans: [] });
    expect(one(db, "SELECT 1 FROM person WHERE id = ?", ana)).toBeUndefined();
    expect(one(db, "SELECT 1 FROM person_organization WHERE person_id = ?", ana)).toBeUndefined();
    expect(one(db, "SELECT 1 FROM entity_tag WHERE entity_id = ?", ana)).toBeUndefined();
    expect(one(db, "SELECT 1 FROM note WHERE entity_id = ?", ana)).toBeUndefined();
    expect(many(db, "SELECT op FROM change_log WHERE row_id = ?", ana)).toEqual([{ op: "delete" }]);
    // O cartão continua, sem o contato.
    expect(one<{ person_id: string | null }>(db, "SELECT person_id FROM deal WHERE id = ?", card)).toEqual({ person_id: null });
    expect(listTrash(db, va)).toEqual([]);
  });

  it("restaurar exige o funil ativo; cada um vê o que excluiu; o administrador vê tudo", async () => {
    const { db, actx, bctx, vendas, va, vb } = await setup();
    const card = createCard(db, bctx, { pipelineId: vendas, title: "Escola Beta" });
    deleteCard(db, bctx, card);
    const tag = createTag(db, actx, { entity: "deal", name: "Quente" });
    deleteTag(db, actx, tag);
    expect(listTrash(db, vb).map((t) => t.title)).toEqual(["Escola Beta"]);
    expect(
      listTrash(db, va)
        .map((t) => t.title)
        .sort(),
    ).toEqual(["Escola Beta", "Quente"]);
    const tagItem = listTrash(db, va).find((t) => t.title === "Quente")!;
    expect(() => restoreTrashItem(db, bctx, vb, tagItem.id)).toThrow(/você mesmo excluiu/);
    deletePipeline(db, actx, vendas); // sem cartões ativos: o cartão excluído não impede
    const cardItem = listTrash(db, vb)[0]!;
    expect(() => restoreTrashItem(db, bctx, vb, cardItem.id)).toThrow(/Restaure antes o funil “Vendas”, que também está na lixeira/);
    const pipeItem = listTrash(db, va).find((t) => t.entity === "pipeline")!;
    restoreTrashItem(db, actx, va, pipeItem.id);
    restoreTrashItem(db, bctx, vb, cardItem.id);
    expect(getCard(db, card)?.title).toBe("Escola Beta");
  });

  it("vínculos desfeitos na exclusão voltam ao restaurar (tag)", async () => {
    const { db, actx, vendas, va } = await setup();
    const card = createCard(db, actx, { pipelineId: vendas, title: "A" });
    const tag = createTag(db, actx, { entity: "deal", name: "Quente" });
    setEntityTags(db, actx, "deal", card, [tag]);
    deleteTag(db, actx, tag);
    expect(getEntityTags(db, card)).toEqual([]);
    restoreTrashItem(db, actx, va, listTrash(db, va)[0]!.id);
    expect(getEntityTags(db, card).map((t) => t.name)).toEqual(["Quente"]);
  });

  it("prazo configurável e itens vencidos; etapa usada no histórico fica só marcada", async () => {
    const { db, actx, vendas, va } = await setup();
    expect(retentionDays(db)).toBe(30);
    expect(() => setRetentionDays(db, actx, 0)).toThrow(/1 a 365/);
    setRetentionDays(db, actx, 7);
    expect(retentionDays(db)).toBe(7);
    const act = createActivity(db, actx, { title: "Ligar", dueAt: "2026-11-02T13:00:00.000Z" });
    expect(deleteActivity(db, actx, act).days).toBe(7);
    expect(expiredTrashIds(db)).toEqual([]);
    expect(expiredTrashIds(db, new Date(Date.now() + 8 * 86400_000))).toHaveLength(1);
    // Etapa removida do funil com um cartão que passou por ela.
    const stages = many<{ id: string; name: string }>(db, "SELECT id, name FROM stage WHERE pipeline_id = ? ORDER BY position", vendas);
    const card = createCard(db, actx, { pipelineId: vendas, stageId: stages[1]!.id, title: "B" });
    const notice = saveStages(db, actx, vendas, [{ id: stages[0]!.id, name: "Prospect" }], { [stages[1]!.id]: stages[0]!.id });
    expect(notice?.label).toBe("Etapa “Proposta”");
    const item = listTrash(db, va).find((t) => t.entity === "stage")!;
    expect(purgeTrash(db, actx, [item.id], noDocs).purged).toBe(1);
    expect(one(db, "SELECT deleted_at FROM stage WHERE id = ?", stages[1]!.id)).toBeTruthy(); // marca ficou (histórico do cartão B)
    expect(getCard(db, card)?.title).toBe("B");
    expect(listTrash(db, va).some((t) => t.entity === "stage")).toBe(false);
  });

  it("exclusão em lote junta o aviso", async () => {
    const { db, actx, vendas, va } = await setup();
    const ids = ["A", "B", "C"].map((t) => createCard(db, actx, { pipelineId: vendas, title: t }));
    const r = bulkCards(db, actx, va, ids, { type: "delete" });
    expect(r.trash).toMatchObject({ __trash: true, label: "3 cartões", days: 30 });
    expect(r.trash!.ids).toHaveLength(3);
  });
});
