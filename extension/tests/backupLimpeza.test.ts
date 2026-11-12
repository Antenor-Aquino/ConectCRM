// Limpeza semanal dos backups: quais arquivos saem e quando perguntar.
import { describe, expect, it } from "vitest";
import { isCleanupDue, isDbBackupFile, oldBackups } from "../src/lib/backupCleanup";

const now = Date.parse("2026-11-10T12:00:00");
const daysAgo = (d: number) => now - d * 86_400_000;

describe("limpeza de backups antigos", () => {
  it("reconhece só os backups do banco", () => {
    expect(isDbBackupFile("diario_conectcrm-backup-auto-2026-11-01T08-00-00-000Z.sqlite")).toBe(true);
    expect(isDbBackupFile("Semanal_conectcrm-backup-auto-2026-10-25_2026-10-31T08-00-00-000Z.sqlite")).toBe(true);
    expect(isDbBackupFile("conectcrm-backup-2026-10-01T10-00-00-000Z.sqlite")).toBe(true);
    expect(isDbBackupFile("conectcrm-configuracoes.json")).toBe(false);
    expect(isDbBackupFile("contrato.pdf")).toBe(false);
    expect(isDbBackupFile("conectcrm-backup-2026-10-01.zip")).toBe(false);
  });
  it("apaga os com mais de 7 dias e sempre deixa o mais recente", () => {
    const f = (name: string, d: number) => ({ name: `${name}.sqlite`, lastModified: daysAgo(d), size: 1000 });
    const files = [f("diario_conectcrm-backup-auto-a", 1), f("diario_conectcrm-backup-auto-b", 8), f("conectcrm-backup-c", 30), f("diario_conectcrm-backup-auto-d", 7), { name: "x.pdf", lastModified: daysAgo(90), size: 1 }];
    expect(oldBackups(files, now).map((x) => x.name)).toEqual(["diario_conectcrm-backup-auto-b.sqlite", "conectcrm-backup-c.sqlite"]);
    // Todos antigos: o mais recente fica.
    expect(oldBackups([f("conectcrm-backup-x", 20), f("conectcrm-backup-y", 40)], now).map((x) => x.name)).toEqual(["conectcrm-backup-y.sqlite"]);
    expect(oldBackups([f("conectcrm-backup-x", 20)], now)).toEqual([]);
  });
  it("pergunta no máximo uma vez por semana (feita ou recusada)", () => {
    expect(isCleanupDue({ lastRunAt: null, lastAskedAt: null }, now)).toBe(true);
    expect(isCleanupDue({ lastRunAt: new Date(daysAgo(3)).toISOString(), lastAskedAt: null }, now)).toBe(false);
    expect(isCleanupDue({ lastRunAt: new Date(daysAgo(8)).toISOString(), lastAskedAt: new Date(daysAgo(2)).toISOString() }, now)).toBe(false);
    expect(isCleanupDue({ lastRunAt: new Date(daysAgo(8)).toISOString(), lastAskedAt: new Date(daysAgo(7)).toISOString() }, now)).toBe(true);
  });
});
