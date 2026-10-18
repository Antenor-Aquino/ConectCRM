import { describe, expect, it } from "vitest";
import { createActivity, getActivity, listActivities, updateActivity } from "../src/db/activities";
import { createOrganization, createPerson } from "../src/db/contacts";
import { createCard } from "../src/db/deals";
import { MIGRATIONS, runMigrations } from "../src/db/migrate";
import { listDocumentTypes } from "../src/db/documents";
import { createPipeline } from "../src/db/pipelines";
import { createTag } from "../src/db/tags";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { freshDb, emptyDb } from "./helpers";
import { one } from "../src/db/sql";

const file = (filename: string, mime: string, sha = "b".repeat(64)) => ({ sha256: sha, mime, size: 10, filename, location: "browser" as const });

describe("tarefas: início, finalização, tags, anexos e vínculos", () => {
  it("finalização opcional e nunca antes do início; início pode ser futuro", async () => {
    const { db, ctx } = await freshDb();
    const future = new Date(Date.now() + 5 * 86400_000).toISOString();
    const id = createActivity(db, ctx, { title: "Começa depois", dueAt: future });
    expect(getActivity(db, id)!.end_at).toBeNull();
    expect(() => updateActivity(db, ctx, id, { endAt: new Date(Date.now() + 86400_000).toISOString() })).toThrow(/antes do início/);
    const end = new Date(Date.now() + 7 * 86400_000).toISOString();
    updateActivity(db, ctx, id, { endAt: end });
    expect(getActivity(db, id)!.end_at).toBe(end);
    updateActivity(db, ctx, id, { endAt: null });
    expect(getActivity(db, id)!.end_at).toBeNull();
    // Sem finalização: atrasada quando o início é de um dia que já passou.
    createActivity(db, ctx, { title: "Antiga sem prazo", dueAt: new Date(Date.now() - 9 * 86400_000).toISOString() });
    expect(listActivities(db, { overdue: true }).map((a) => a.title)).toEqual(["Antiga sem prazo"]);
  });

  it("lista traz tags, anexos, funil, contato e organização da tarefa", async () => {
    const { db, ctx } = await freshDb();
    const pid = createPipeline(db, ctx, { name: "Negócios", type: "comercial", stages: [{ name: "Prospect" }] });
    const org = createOrganization(db, ctx, { name: "Posto 5 irmãos" });
    const person = createPerson(db, ctx, { name: "Antenor Aquino", organizationIds: [org] });
    const deal = createCard(db, ctx, { pipelineId: pid, title: "Negociação Teste", personId: person, organizationId: org });
    const tag = createTag(db, ctx, { entity: "activity", name: "Urgente", color: "red" });
    const id = createActivity(db, ctx, { title: "Enviar proposta", dealId: deal, tagIds: [tag] });
    const typeId = listDocumentTypes(db)[0]!.id;
    methods["documents.create"](db, ctx, { name: "Proposta", typeId, links: [{ type: "activity", id }], file: file("proposta.pdf", "application/pdf") });
    const [t] = listActivities(db);
    expect(t).toMatchObject({
      title: "Enviar proposta",
      deal_title: "Negociação Teste",
      pipeline_id: pid,
      pipeline_name: "Negócios",
      person_id: person,
      person_name: "Antenor Aquino",
      organization_id: org,
      organization_name: "Posto 5 irmãos",
    });
    expect(t!.tags).toEqual([{ id: tag, name: "Urgente", color: "red" }]);
    expect(t!.documents).toEqual([expect.objectContaining({ name: "Proposta", filename: "proposta.pdf", mime: "application/pdf" })]);
    expect(getActivity(db, id)!.tagIds).toEqual([tag]);
    // Tag de outra entidade é recusada.
    const dealTag = createTag(db, ctx, { entity: "deal", name: "Venda" });
    expect(() => updateActivity(db, ctx, id, { tagIds: [dealTag] })).toThrow(/outro tipo/);
  });

  it("documento da tarefa segue a permissão da tarefa", async () => {
    const { db, ctx } = await freshDb();
    createUser(db, ctx, { name: "Admin", role: "admin" });
    const ana = createUser(db, ctx, { name: "Ana", role: "vendedor" });
    const bruno = createUser(db, ctx, { name: "Bruno", role: "vendedor" });
    const id = createActivity(db, { ...ctx, userId: ana }, { title: "Da Ana", ownerId: ana });
    const p = { name: "Anotações", typeId: listDocumentTypes(db)[0]!.id, links: [{ type: "activity" as const, id }], file: file("a.txt", "text/plain") };
    expect(() => methods["documents.create"](db, { ...ctx, userId: bruno }, p)).toThrow(/permissão/);
    const doc = methods["documents.create"](db, { ...ctx, userId: ana }, p);
    const versionId = methods["documents.get"](db, { ...ctx, userId: ana }, { id: doc })!.version_id;
    expect(() => methods["documents.file"](db, { ...ctx, userId: bruno }, { versionId, action: "view" })).toThrow(/permissão/);
    expect(methods["documents.file"](db, { ...ctx, userId: ana }, { versionId, action: "view" })).toMatchObject({ location: "browser", filename: "a.txt" });
  });

  it("migração: data escolhida vira finalização; 'agora' do cadastro não", async () => {
    const db = await emptyDb();
    db.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    for (const m of MIGRATIONS.filter((x) => x.name < "0003")) {
      db.exec(m.sql);
      db.run("INSERT INTO _migrations VALUES (?, ?)", [m.name, new Date().toISOString()]);
    }
    db.run("INSERT INTO workspace (id, name, created_at, updated_at) VALUES ('w', 'W', '2026-01-01', '2026-01-01')");
    db.run("INSERT INTO activity_type (id, workspace_id, name, icon, created_at, updated_at) VALUES ('t', 'w', 'Tarefa', 'check', '2026-01-01', '2026-01-01')");
    const ins = (id: string, created: string, due: string) =>
      db.run("INSERT INTO activity (id, workspace_id, type_id, title, due_at, created_at, updated_at) VALUES (?, 'w', 't', ?, ?, ?, ?)", [id, id, due, created, created]);
    ins("padrao", "2026-10-17T09:44:00.000Z", "2026-10-17T09:44:00.000Z");
    ins("escolhida", "2026-10-10T08:00:00.000Z", "2026-10-15T14:00:00.000Z");
    runMigrations(db);
    const end = (id: string) => one<{ end_at: string | null }>(db, "SELECT end_at FROM activity WHERE id = ?", id)?.end_at;
    expect(end("padrao")).toBeNull();
    expect(end("escolhida")).toBe("2026-10-15T14:00:00.000Z");
  });

  it("migração das tags preserva tags e vínculos e religa as chaves estrangeiras", async () => {
    const db = await emptyDb();
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    for (const m of MIGRATIONS.filter((x) => x.name < "0004")) {
      db.exec(m.sql);
      db.run("INSERT INTO _migrations VALUES (?, ?)", [m.name, new Date().toISOString()]);
    }
    db.run("INSERT INTO workspace (id, name, created_at, updated_at) VALUES ('w', 'W', 'x', 'x')");
    db.run("INSERT INTO tag (id, workspace_id, entity, name, created_at, updated_at) VALUES ('t1', 'w', 'deal', 'Venda', 'x', 'x')");
    db.run("INSERT INTO entity_tag (id, workspace_id, tag_id, entity_type, entity_id, created_at, updated_at) VALUES ('l1', 'w', 't1', 'deal', 'd1', 'x', 'x')");
    expect(runMigrations(db)).toBe(MIGRATIONS.filter((x) => x.name >= "0004").length);
    expect(db.exec("SELECT name FROM tag")[0]!.values).toEqual([["Venda"]]);
    expect(db.exec("SELECT tag_id FROM entity_tag")[0]!.values).toEqual([["t1"]]);
    expect(db.exec("PRAGMA foreign_keys")[0]!.values[0]![0]).toBe(1);
    db.run("INSERT INTO tag (id, workspace_id, entity, name, created_at, updated_at) VALUES ('t2', 'w', 'activity', 'Urgente', 'x', 'x')");
    // A chave estrangeira continua valendo depois da troca de tabela.
    expect(() => db.run("INSERT INTO entity_tag (id, workspace_id, tag_id, entity_type, entity_id, created_at, updated_at) VALUES ('l2', 'w', 'nao-existe', 'deal', 'd1', 'x', 'x')")).toThrow(/FOREIGN KEY/);
  });
});

describe("prazo da tarefa no painel", () => {
  it("dias que faltam, vence hoje, atraso, sem prazo e início futuro", async () => {
    const { taskTiming } = await import("../src/lib/taskTiming");
    const now = new Date(2026, 9, 17, 10, 0);
    const at = (d: number, h = 18) => new Date(2026, 9, 17 + d, h, 0).toISOString();
    const t = (due: string, end: string | null, done = 0, done_at: string | null = null) => taskTiming({ due_at: due, end_at: end, done, done_at }, now);
    expect(t(at(-2), at(3))).toEqual({ label: "faltam 3 dias", tone: "ok", span: "5 dias" });
    expect(t(at(0, 9), at(1))).toEqual({ label: "falta 1 dia", tone: "warning", span: "1 dia" });
    expect(t(at(0, 9), at(0))).toEqual({ label: "vence hoje", tone: "warning", span: "mesmo dia" });
    expect(t(at(-5), at(-2)).label).toBe("atrasada há 2 dias");
    expect(t(at(0, 8), at(0, 9)).label).toBe("atrasada (venceu hoje)");
    expect(t(at(-4, 9), null)).toEqual({ label: "atrasada há 4 dias (sem finalização)", tone: "danger", span: null });
    expect(t(at(0, 9), null).label).toBe("iniciada hoje · sem prazo");
    expect(t(at(2, 9), null).label).toBe("começa em 2 dias");
    expect(t(at(1, 9), null).label).toBe("começa amanhã");
    expect(t(at(-3), at(-1), 1, at(0, 9)).label).toBe("concluída com 1 dia de atraso");
    expect(t(at(-3), at(1), 1, at(0, 9)).label).toBe("concluída no prazo");
  });
});
