import { describe, expect, it } from "vitest";
import { bootstrap, DEFAULT_ACTIVITY_TYPES } from "../src/db/bootstrap";
import { runMigrations } from "../src/db/migrate";
import { getRow, insertRow, restore, rowHistory, softDelete, updateRow } from "../src/db/repo";
import { many, one, withTransaction } from "../src/db/sql";
import { freshDb } from "./helpers";

describe("migrations e dados iniciais", () => {
  it("aplica o esquema e é idempotente", async () => {
    const { db } = await freshDb();
    expect(runMigrations(db)).toBe(0);
    const tables = many<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    for (const t of ["pipeline", "stage", "deal", "person", "organization", "activity", "tag", "custom_field", "change_log"]) {
      expect(tables).toContain(t);
    }
  });

  it("cria um único workspace e os tipos de tarefa padrão", async () => {
    const { db, ctx } = await freshDb();
    expect(bootstrap(db)).toBe(ctx.workspaceId);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM workspace")?.n).toBe(1);
    const types = many<{ name: string }>(db, "SELECT name FROM activity_type ORDER BY position").map((t) => t.name);
    expect(types).toEqual(DEFAULT_ACTIVITY_TYPES.map((t) => t.name));
  });
});

describe("repo: gravação preparada para sincronização", () => {
  it("insert preenche autoria/versão e registra no change_log", async () => {
    const { db, ctx } = await freshDb();
    const id = insertRow(db, { ...ctx, userId: null }, "person", { name: "Mieza", phone: "+5511999998888" });
    const row = getRow(db, "person", id)!;
    expect(row.workspace_id).toBe(ctx.workspaceId);
    expect(row.version).toBe(1);
    expect(row.created_at).toBe(row.updated_at);
    const log = rowHistory(db, "person", id);
    expect(log).toHaveLength(1);
    expect(log[0]!.op).toBe("insert");
    expect(JSON.parse(log[0]!.changes).name).toEqual([null, "Mieza"]);
  });

  it("update grava só o que mudou e incrementa a versão", async () => {
    const { db, ctx } = await freshDb();
    const id = insertRow(db, ctx, "person", { name: "Regina", email: null });
    expect(updateRow(db, ctx, "person", id, { name: "Regina" })).toBe(false);
    expect(updateRow(db, ctx, "person", id, { name: "Regina Souza", email: "regina@x.com" })).toBe(true);
    expect(getRow(db, "person", id)!.version).toBe(2);
    const log = rowHistory(db, "person", id);
    expect(log.map((l) => l.op)).toEqual(["insert", "update"]);
    expect(JSON.parse(log[1]!.changes)).toEqual({ name: ["Regina", "Regina Souza"], email: [null, "regina@x.com"] });
  });

  it("update recusa versão desatualizada", async () => {
    const { db, ctx } = await freshDb();
    const id = insertRow(db, ctx, "person", { name: "Cris" });
    updateRow(db, ctx, "person", id, { name: "Cris M." }, 1);
    expect(() => updateRow(db, ctx, "person", id, { name: "Outro" }, 1)).toThrow(/alterado em outro lugar/);
  });

  it("exclusão é lógica e pode ser desfeita", async () => {
    const { db, ctx } = await freshDb();
    const id = insertRow(db, ctx, "person", { name: "Daniel" });
    softDelete(db, ctx, "person", id);
    expect(getRow(db, "person", id)).toBeUndefined();
    expect(getRow(db, "person", id, { includeDeleted: true })!.deleted_at).not.toBeNull();
    restore(db, ctx, "person", id);
    expect(getRow(db, "person", id)!.version).toBe(3);
    expect(rowHistory(db, "person", id).map((l) => l.op)).toEqual(["insert", "delete", "restore"]);
  });

  it("não aceita gravar colunas de sistema nem tabelas desconhecidas", async () => {
    const { db, ctx } = await freshDb();
    expect(() => insertRow(db, ctx, "person", { name: "X", version: 9 })).toThrow(/sistema/);
    expect(() => insertRow(db, ctx, "workspace" as never, { name: "X" })).toThrow(/desconhecida/);
  });

  it("falha no meio desfaz tudo (transação)", async () => {
    const { db, ctx } = await freshDb();
    expect(() => insertRow(db, ctx, "stage", { pipeline_id: "nao-existe", name: "X" })).toThrow();
    expect(one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'stage'")?.n).toBe(0);
  });

  it("CNPJ é único só entre organizações não excluídas", async () => {
    const { db, ctx } = await freshDb();
    const a = insertRow(db, ctx, "organization", { name: "ABMES", cnpj: "11222333000181" });
    expect(() => insertRow(db, ctx, "organization", { name: "Dup", cnpj: "11222333000181" })).toThrow();
    softDelete(db, ctx, "organization", a);
    expect(() => insertRow(db, ctx, "organization", { name: "Nova", cnpj: "11222333000181" })).not.toThrow();
  });

  it("transação com erro é desfeita por inteiro", async () => {
    const { db, ctx } = await freshDb();
    expect(() =>
      withTransaction(db, () => {
        insertRow(db, ctx, "person", { name: "Jean" });
        throw new Error("falhou no meio");
      }),
    ).toThrow("falhou no meio");
    expect(one(db, "SELECT 1 FROM person WHERE name = 'Jean'")).toBeUndefined();
    insertRow(db, ctx, "person", { name: "Jean" });
    expect(many(db, "SELECT 1 FROM person WHERE name = 'Jean'")).toHaveLength(1);
  });
});
