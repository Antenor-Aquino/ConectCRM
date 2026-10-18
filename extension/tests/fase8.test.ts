import { describe, expect, it } from "vitest";
import { countPersons } from "../src/db/contacts";
import { getBoard } from "../src/db/deals";
import { openDatabase, validateBackup } from "../src/db/open";
import { listPipelines } from "../src/db/pipelines";
import { listUsers } from "../src/db/users";
import { autoBackupFilename, isBackupDue } from "../src/lib/autoBackup";
import { base64ToBytes, bytesToBase64 } from "../src/lib/environment";
import { emptyDb, sqlite } from "./helpers";

const sql = sqlite;

describe("nome do backup (horário local)", () => {
  const d = new Date(2026, 6, 5, 14, 21, 14, 607);
  it("diário", () => expect(autoBackupFilename("daily", d)).toBe("diario_conectcrm-backup-auto-2026-07-05T14-21-14-607Z.sqlite"));
  it("semanal com o intervalo domingo-sábado", () =>
    expect(autoBackupFilename("weekly", d)).toBe("Semanal_conectcrm-backup-auto-2026-07-05_2026-07-11T14-21-14-607Z.sqlite"));
});

describe("quando o backup vence", () => {
  it("diário: muda o dia LOCAL (às 22h no Brasil ainda é o mesmo dia)", () => {
    const morning = new Date(2026, 9, 16, 8, 0);
    expect(isBackupDue("daily", null)).toBe(true);
    expect(isBackupDue("daily", morning.toISOString(), new Date(2026, 9, 16, 22, 30))).toBe(false);
    expect(isBackupDue("daily", morning.toISOString(), new Date(2026, 9, 17, 0, 5))).toBe(true);
  });
  it("semanal: só na semana seguinte (segunda)", () => {
    const monday = new Date(2026, 9, 12, 9);
    expect(isBackupDue("weekly", monday.toISOString(), new Date(2026, 9, 18, 20))).toBe(false);
    expect(isBackupDue("weekly", monday.toISOString(), new Date(2026, 9, 19, 8))).toBe(true);
  });
});

describe("ambiente de teste e restauração", () => {
  it("o ambiente de teste nasce com os dados de exemplo do mockup", async () => {
    const { db } = openDatabase(await sql(), null, { seedDemo: true });
    expect(listUsers(db).map((u) => u.role).sort()).toEqual(["admin", "gestor", "vendedor", "vendedor"]);
    const pipes = listPipelines(db);
    expect(pipes.map((p) => p.name)).toEqual(["PowerCubus", "Implantação PUC-PR", "Suporte"]);
    const board = getBoard(db, pipes[0]!.id);
    expect(board.map((c) => [c.name, c.count])).toEqual([["Prospecção", 6], ["Contato", 4], ["Reunião", 1], ["Pendência Pedagógica", 0]]);
    expect(countPersons(db)).toBe(12);
  });

  it("produção vazia não recebe dados de exemplo; reabrir não duplica", async () => {
    const SQL = await sql();
    const prod = openDatabase(SQL, null);
    expect(listPipelines(prod.db)).toHaveLength(0);
    const demo = openDatabase(SQL, null, { seedDemo: true });
    const again = openDatabase(SQL, demo.db.export(), { seedDemo: true });
    expect(countPersons(again.db)).toBe(12);
    expect(again.workspaceId).toBe(demo.workspaceId);
  });

  it("valida o arquivo antes de restaurar e o backup volta igual", async () => {
    const SQL = await sql();
    const demo = openDatabase(SQL, null, { seedDemo: true });
    const b64 = bytesToBase64(demo.db.export());
    const bytes = base64ToBytes(b64);
    expect(() => validateBackup(SQL, bytes)).not.toThrow();
    expect(countPersons(openDatabase(SQL, bytes).db)).toBe(12);
    const other = await emptyDb();
    other.run("CREATE TABLE x (a)");
    expect(() => validateBackup(SQL, other.export())).toThrow(/não é um backup do ConectCRM/);
    expect(() => validateBackup(SQL, new TextEncoder().encode("texto qualquer"))).toThrow(/não é um backup/);
  });
});

describe("iniciais dos usuários de exemplo", () => {
  it("ignora parênteses e pontuação", async () => {
    const { initials } = await import("../src/lib/format");
    expect(initials("Gustavo (gestor)")).toBe("GG");
    expect(initials("Administrador (teste)")).toBe("AT");
    expect(initials("Ana Vendas")).toBe("AV");
    expect(initials("  ")).toBe("?");
  });
});
