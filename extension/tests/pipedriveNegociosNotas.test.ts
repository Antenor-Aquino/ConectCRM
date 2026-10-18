import { describe, expect, it } from "vitest";
import { createLossReason, getCardRow } from "../src/db/deals";
import { importExternalDeals, importExternalNotes, importExternalOrganizations, importExternalPersons } from "../src/db/externalImport";
import { listNotes } from "../src/db/notes";
import { createPipeline } from "../src/db/pipelines";
import { many, one } from "../src/db/sql";
import { PipedriveClient } from "../src/lib/pipedrive/api";
import { buildRow, crmTargets, guessFieldMapping, htmlToText, noteRows, sourceFields, summarize } from "../src/lib/pipedrive/records";
import { pipedriveRecordUrl } from "../src/lib/integrations";
import { freshDb } from "./helpers";

const P = "pipedrive" as const;
type Db = Awaited<ReturnType<typeof freshDb>>["db"];
const stagesOf = (db: Db, pipelineId: string) =>
  many<{ id: string; name: string }>(db, "SELECT id, name FROM stage WHERE pipeline_id = ? AND deleted_at IS NULL ORDER BY position", pipelineId);

describe("negócios do Pipedrive", () => {
  it("etapa por linha (funis diferentes), ganho com data, perdido com motivo cadastrado ou observação, datas da origem", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }, { name: "Proposta" }] });
    const parc = createPipeline(db, ctx, { name: "Parcerias", type: "comercial", stages: [{ name: "Contato" }] });
    const suporte = createPipeline(db, ctx, { name: "Suporte", type: "operacional", stages: [{ name: "Novo" }] });
    const [, proposta] = stagesOf(db, vendas);
    const [contato] = stagesOf(db, parc);
    const preco = createLossReason(db, ctx, "Preço");
    importExternalOrganizations(db, ctx, { provider: P, rows: [{ externalId: "10", label: "Alfa", name: "Alfa" }] });
    const r = importExternalDeals(db, ctx, {
      provider: P,
      rows: [
        {
          externalId: "101",
          label: "D1",
          title: "D1",
          stageId: proposta!.id,
          status: "won",
          createdAt: "2026-01-10T12:00:00.000Z",
          closedAt: "2026-02-01T15:00:00.000Z",
          organizationExternalId: "10",
        },
        { externalId: "102", label: "D2", title: "D2", stageId: contato!.id, status: "lost", lossReason: "preço" },
        { externalId: "103", label: "D3", title: "D3", stageId: contato!.id, status: "lost", lossReason: "Sumiu" },
        { externalId: "104", label: "D4", title: "D4", stageId: stagesOf(db, suporte)[0]!.id },
        { externalId: "105", label: "D5", title: "D5" },
      ],
    });
    expect(r.created).toBe(3);
    expect(r.errors.map((e) => e.message)).toEqual(["D4: Leads e negócios entram num funil comercial.", "D5: Escolha a etapa de destino."]);
    const card = (t: string) => getCardRow(db, one<{ id: string }>(db, "SELECT id FROM deal WHERE title = ?", t)!.id)!;
    expect([card("D1").pipeline_id, card("D1").status, card("D1").created_at, card("D1").closed_at]).toEqual([
      vendas,
      "won",
      "2026-01-10T12:00:00.000Z",
      "2026-02-01T15:00:00.000Z",
    ]);
    expect(card("D1").organization_id).toBe(one<{ id: string }>(db, "SELECT id FROM organization")!.id);
    expect([card("D2").pipeline_id, card("D2").loss_reason_id, card("D2").loss_note]).toEqual([parc, preco, null]);
    expect([card("D3").loss_reason_id, card("D3").loss_note]).toEqual([null, "Sumiu"]);
    // Atualizar: mudou de etapa e foi reaberto no Pipedrive.
    const d2 = card("D2").id;
    importExternalDeals(db, ctx, { provider: P, rows: [{ externalId: "102", label: "D2", localId: d2, update: true, stageId: proposta!.id, status: "open" }] });
    expect([card("D2").pipeline_id, card("D2").stage_id, card("D2").status]).toEqual([vendas, proposta!.id, "open"]);
  });

  it("notas: entram no registro importado, uma vez por registro, com autor, data e fixação", async () => {
    const { db, ctx } = await freshDb();
    const vendas = createPipeline(db, ctx, { name: "Vendas", type: "comercial", stages: [{ name: "Prospect" }] });
    importExternalPersons(db, ctx, { provider: P, rows: [{ externalId: "7", label: "Ana", name: "Ana" }] });
    importExternalDeals(db, ctx, { provider: P, pipelineId: vendas, rows: [{ externalId: "uuid-1", label: "Lead", title: "Lead" }] });
    const note = { externalId: "900", body: "Ligou pedindo proposta", author: "Antenor", createdAt: "2026-03-01T13:00:00.000Z", pinned: true };
    const r = importExternalNotes(db, ctx, {
      provider: P,
      rows: [
        { ...note, entity: "deal", parentExternalId: "uuid-1" },
        { ...note, entity: "person", parentExternalId: "7", pinned: false },
        { ...note, entity: "organization", parentExternalId: "99" }, // organização não importada
        { externalId: "901", entity: "person", parentExternalId: "7", body: "   " },
      ],
    });
    expect(r).toEqual({ created: 2, skipped: 2, errors: [] });
    const cardId = one<{ id: string }>(db, "SELECT id FROM deal")!.id;
    const [n] = listNotes(db, "deal", cardId);
    expect([n!.body, n!.pinned, n!.created_at]).toEqual(["Nota do Pipedrive · Antenor\n\nLigou pedindo proposta", 1, "2026-03-01T13:00:00.000Z"]);
    // Reimportar não duplica.
    expect(importExternalNotes(db, ctx, { provider: P, rows: [{ ...note, entity: "deal", parentExternalId: "uuid-1" }] })).toEqual({
      created: 0,
      skipped: 1,
      errors: [],
    });
    expect(listNotes(db, "deal", cardId)).toHaveLength(1);
  });
});

describe("conversão de negócios e notas", () => {
  it("negócio v2: etapa do de-para, situação, motivo, datas, contato e organização", () => {
    const sources = sourceFields("deal", {
      fields: [{ key: "label_ids", name: "Etiqueta", field_type: "set", options: [{ id: 3, label: "Quente" }] }],
      users: [],
    });
    const raw = {
      id: 55,
      title: "Contrato Alfa",
      value: 2500,
      currency: "BRL",
      status: "lost",
      lost_reason: "Preço",
      stage_id: 4,
      pipeline_id: 1,
      person_id: 7,
      org_id: 10,
      label_ids: [3],
      add_time: "2026-01-10T12:00:00Z",
      update_time: "2026-02-01T15:00:00Z",
      lost_time: "2026-02-01T15:00:00Z",
    };
    const targets = crmTargets("deal", []);
    const row = buildRow("deal", raw, sources, targets, {
      fields: guessFieldMapping("deal", sources, targets),
      owners: {},
      options: {},
      stages: { "4": "crm-stage" },
    });
    expect(row).toMatchObject({
      title: "Contrato Alfa",
      value: "2500",
      tags: ["Quente"],
      stageId: "crm-stage",
      status: "lost",
      lossReason: "Preço",
      createdAt: "2026-01-10T12:00:00Z",
      closedAt: "2026-02-01T15:00:00Z",
      personExternalId: "7",
      organizationExternalId: "10",
    });
    expect(summarize("deal", raw)).toMatchObject({ stageId: "4", pipelineId: "1", status: "lost", detail: "BRL 2.500,00" });
    expect(pipedriveRecordUrl("stepple", "deal", "55")).toBe("https://stepple.pipedrive.com/deal/55");
  });

  it("notas: HTML vira texto; autor pelo usuário; fixada conforme o registro", () => {
    expect(htmlToText("<p>Olá&nbsp;<b>Ana</b></p><ul><li>item 1</li><li>item 2</li></ul>R&amp;D<br>fim")).toBe("Olá Ana\n• item 1\n• item 2\nR&D\nfim");
    const rows = noteRows(
      "lead",
      "uuid-1",
      [{ id: 1, content: "<p>x</p>", add_time: "2026-03-01 13:00:00", user_id: 11, pinned_to_lead_flag: true }],
      [{ id: 11, name: "Antenor", email: "" }],
    );
    expect(rows).toEqual([
      { externalId: "1", entity: "deal", parentExternalId: "uuid-1", body: "x", author: "Antenor", createdAt: "2026-03-01T13:00:00.000Z", pinned: true },
    ]);
  });

  it("notas pela API: filtro pelo registro e todas as páginas", async () => {
    const calls: URL[] = [];
    const fetchFn = async (u: string) => {
      const url = new URL(u);
      calls.push(url);
      const start = Number(url.searchParams.get("start"));
      const body = {
        success: true,
        data: [{ id: start + 1, content: "n" }],
        additional_data: { pagination: { more_items_in_collection: start === 0, next_start: 500 } },
      };
      return new Response(JSON.stringify(body));
    };
    const notes = await new PipedriveClient("t", fetchFn).notes("organization", "10");
    expect(notes.map((n) => n.id)).toEqual([1, 501]);
    expect(calls.map((c) => [c.pathname, c.searchParams.get("org_id"), c.searchParams.get("start")])).toEqual([
      ["/v1/notes", "10", "0"],
      ["/v1/notes", "10", "500"],
    ]);
  });
});
