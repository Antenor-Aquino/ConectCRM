import { describe, expect, it } from "vitest";
import { importCards } from "../src/db/cardImporter";
import { createCustomField, getCustomValues, listCustomFields } from "../src/db/customFields";
import { assertCanAssign, getCardRow } from "../src/db/deals";
import { createPipeline } from "../src/db/pipelines";
import { getEntityTags } from "../src/db/tags";
import { createUser, getViewer } from "../src/db/users";
import { many, one } from "../src/db/sql";
import { parseImportDay, parseMoneyCents, parseNumber, parseYesNo, splitList } from "../src/lib/importParse";
import { freshDb } from "./helpers";

type Db = Awaited<ReturnType<typeof freshDb>>["db"];
const stagesOf = (db: Db, pipelineId: string) =>
  many<{ id: string; name: string }>(db, "SELECT id, name FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position", pipelineId);
const cardsOf = (db: Db, pipelineId: string) =>
  many<{ id: string; title: string; stage_id: string }>(db, "SELECT id, title, stage_id FROM deal WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY title", pipelineId);

describe("conversão dos textos da planilha", () => {
  it("valores em reais e números nos formatos brasileiro e inglês", () => {
    expect(parseMoneyCents("R$ 1.500,00", "Valor")).toBe(150000);
    expect(parseMoneyCents("1,234.56", "Valor")).toBe(123456);
    expect(parseMoneyCents("1500,5", "Valor")).toBe(150050);
    expect(parseMoneyCents("1500.5", "Valor")).toBe(150050);
    expect(parseMoneyCents("1.234.567", "Valor")).toBe(123456700);
    expect(parseMoneyCents("", "Valor")).toBeNull();
    expect(() => parseMoneyCents("mil reais", "Valor")).toThrow(/não reconhecido/);
    expect(parseNumber("-3,5")).toBe(-3.5);
  });

  it("datas dd/mm/aaaa, aaaa-mm-dd e inválidas", () => {
    expect(parseImportDay("01/02/2026", "Data")).toBe("2026-02-01");
    expect(parseImportDay("2026-02-01", "Data")).toBe("2026-02-01");
    expect(parseImportDay("1/2/26", "Data")).toBe("2026-02-01");
    expect(() => parseImportDay("31/02/2026", "Data")).toThrow(/não reconhecida/);
  });

  it("sim/não e listas", () => {
    expect([parseYesNo("Sim"), parseYesNo("x"), parseYesNo("Não"), parseYesNo("")]).toEqual([true, true, false, null]);
    expect(splitList("VIP; Escola , Urgente")).toEqual(["VIP", "Escola", "Urgente"]);
  });
});

describe("importar cartões por planilha", () => {
  it("cria cartões na etapa do de-para, com contato, organização, tags, valor e situação", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }, { name: "Proposta" }] });
    const [prospect, proposta] = stagesOf(db, vendas);
    const r = importCards(db, ctx, {
      pipelineId: vendas,
      defaultStageId: prospect!.id,
      rows: [
        {
          title: "Colégio Alfa",
          stageId: proposta!.id,
          value: "R$ 2.500,00",
          personName: "Ana Souza",
          personEmail: "ana@alfa.com.br",
          organizationName: "Colégio Alfa Ltda",
          tags: "Escola; VIP",
          expectedCloseAt: "15/12/2026",
        },
        { title: "Colégio Beta", status: "won", personEmail: "ANA@alfa.com.br" },
        { title: "" },
      ],
    });
    expect(r.created).toBe(2);
    expect(r.errors).toEqual([{ row: 4, message: expect.stringMatching(/sem nome/) }]);
    const [alfa, beta] = cardsOf(db, vendas);
    const a = getCardRow(db, alfa!.id)!;
    expect([a.stage_id, a.value_cents, a.status]).toEqual([proposta!.id, 250000, "open"]);
    expect(new Date(a.expected_close_at!).getDate()).toBe(15);
    expect(getEntityTags(db, a.id).map((t) => t.name).sort()).toEqual(["Escola", "VIP"]);
    const org = one<{ id: string }>(db, "SELECT id FROM organization WHERE name = 'Colégio Alfa Ltda'")!;
    expect(a.organization_id).toBe(org.id);
    // O segundo cartão usa o mesmo contato (achado pelo e-mail) e a etapa padrão.
    const b = getCardRow(db, beta!.id)!;
    expect([b.person_id, b.stage_id, b.status]).toEqual([a.person_id, prospect!.id, "won"]);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM person WHERE deleted_at IS NULL")!.n).toBe(1);
  });

  it("ignora nomes que já existem no funil (inclusive repetidos na planilha) e informa a linha", async () => {
    const { db, ctx } = await freshDb();
    const p = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    importCards(db, ctx, { pipelineId: p, rows: [{ title: "Erro no login" }] });
    const r = importCards(db, ctx, { pipelineId: p, firstLine: 202, rows: [{ title: "erro no LOGIN" }, { title: "Lentidão" }, { title: "Lentidão" }] });
    expect(r.created).toBe(1);
    expect(r.skipped.map((s) => s.row)).toEqual([202, 204]);
    const tickets = many<{ ticket_number: number }>(db, "SELECT ticket_number FROM deal ORDER BY ticket_number");
    expect(tickets.map((t) => t.ticket_number)).toEqual([1, 2]);
    expect(importCards(db, ctx, { pipelineId: p, skipExisting: false, rows: [{ title: "Lentidão" }] }).created).toBe(1);
  });

  it("campos personalizados: opção pelo id do de-para ou pelo rótulo, número, data e sim/não", async () => {
    const { db, ctx } = await freshDb();
    const p = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }] });
    createCustomField(db, ctx, { entity: "deal", name: "Origem do lead", fieldType: "select", options: [{ label: "Site" }, { label: "Indicação" }] });
    createCustomField(db, ctx, { entity: "deal", name: "Produtos", fieldType: "multiselect", options: [{ label: "ERP" }, { label: "CRM" }] });
    createCustomField(db, ctx, { entity: "deal", name: "Alunos", fieldType: "number" });
    createCustomField(db, ctx, { entity: "deal", name: "Visita", fieldType: "date" });
    createCustomField(db, ctx, { entity: "deal", name: "Contrato assinado", fieldType: "boolean" });
    const f = Object.fromEntries(listCustomFields(db, "deal").map((x) => [x.name, x]));
    const site = f["Origem do lead"]!.options[0]!.id;
    const r = importCards(db, ctx, {
      pipelineId: p,
      rows: [
        {
          title: "Escola X",
          custom: { [f["Origem do lead"]!.id]: site, [f.Produtos!.id]: ["erp", "CRM"], [f.Alunos!.id]: "1.200", [f.Visita!.id]: "05/03/2026", [f["Contrato assinado"]!.id]: "Sim" },
        },
        { title: "Escola Y", custom: { [f["Origem do lead"]!.id]: "Outdoor" } },
      ],
    });
    expect(r.created).toBe(1);
    expect(r.errors[0]).toEqual({ row: 3, message: 'Campo "Origem do lead": a opção "Outdoor" não existe.' });
    const id = cardsOf(db, p)[0]!.id;
    const v = getCustomValues(db, id);
    expect(v[f["Origem do lead"]!.id]).toBe(site);
    expect(v[f.Produtos!.id]).toEqual(f.Produtos!.options.map((o) => o.id));
    expect([v[f.Alunos!.id], v[f.Visita!.id], v[f["Contrato assinado"]!.id]]).toEqual([1200, "2026-03-05", true]);
    // A linha com erro não deixou contato, tag ou cartão pela metade.
    expect(cardsOf(db, p).map((c) => c.title)).toEqual(["Escola X"]);
  });

  it("linha com erro desfaz o contato criado nela; vendedor só importa para si", async () => {
    const { db, ctx } = await freshDb();
    const p = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }] });
    const r = importCards(db, ctx, { pipelineId: p, rows: [{ title: "X", personName: "Bruno", value: "abc", tags: "Nova" }, { title: "Y", tags: "Nova" }] });
    expect(r.errors[0]!.message).toMatch(/Valor/);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM person")!.n).toBe(0);
    expect(getEntityTags(db, cardsOf(db, p)[0]!.id).map((t) => t.name)).toEqual(["Nova"]);

    createUser(db, ctx, { name: "Admin", role: "admin" });
    const vendedor = createUser(db, ctx, { name: "Carla", role: "vendedor" });
    const outro = createUser(db, ctx, { name: "Davi", role: "vendedor" });
    const v = getViewer(db, vendedor);
    const vctx = { ...ctx, userId: vendedor };
    const res = importCards(db, vctx, { pipelineId: p, rows: [{ title: "Meu" }, { title: "Do Davi", ownerId: outro }] }, (o) => assertCanAssign(db, v, o));
    expect(res.created).toBe(1);
    expect(res.errors[0]!.message).toMatch(/Vendedor só pode atribuir/);
  });
});
