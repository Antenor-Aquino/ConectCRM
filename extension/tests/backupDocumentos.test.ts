// Backup dos documentos: lista do espelho (pastas do GED, nome legível,
// versões anteriores, lixeira fora), índice CSV, frequência e retenção dos
// backups automáticos do banco.
import { describe, expect, it } from "vitest";
import { backupTarget, documentBackupList, safeSegment } from "../src/db/documentBackup";
import * as docs from "../src/db/documents";
import * as folders from "../src/db/documentFolders";
import { createUser } from "../src/db/users";
import { methods } from "../src/rpc/methods";
import { backupsToPrune } from "../src/lib/autoBackup";
import { indexCsv, isDocBackupDue, isFullVerifyDue } from "../src/lib/docBackup";
import { freshDb } from "./helpers";

const sha = (c: string) => c.repeat(64);
const file = (c: string, filename: string): docs.FileRef => ({ sha256: sha(c), mime: "application/pdf", size: 100, filename, location: "folder", path: `2026-10/x (${c.repeat(8)}).pdf` });

async function setup() {
  const { db, ctx: sys } = await freshDb();
  const admin = createUser(db, sys, { name: "Antenor", role: "admin" });
  const ana = createUser(db, sys, { name: "Ana", role: "vendedor" });
  const ctx = { ...sys, userId: admin };
  const typeId = docs.listDocumentTypes(db)[0]!.id;
  return { db, ctx, admin, ana, typeId };
}

describe("lista do backup dos documentos", () => {
  it("usa as pastas do GED e o nome do documento com o código do conteúdo", async () => {
    const { db, ctx, typeId } = await setup();
    const comercial = folders.createFolder(db, ctx, { name: "Comercial" });
    const contratos = folders.createFolder(db, ctx, { name: "Contratos: 2026", parentId: comercial });
    docs.createDocument(db, ctx, { name: "Contrato Perseus & 2026A", typeId, folderId: contratos, file: file("a", "contrato.PDF") });
    docs.createDocument(db, ctx, { name: "Recibo", typeId, file: file("b", "recibo.jpg") });
    const list = documentBackupList(db);
    expect(list.map((e) => e.target)).toEqual(["Comercial/Contratos_ 2026/Contrato Perseus & 2026A (aaaaaaaa).pdf", "Recibo (bbbbbbbb).jpg"]);
    expect(list[0]).toMatchObject({ folder: "Comercial/Contratos: 2026", current: true, version: 1, createdBy: "Antenor", size: 100 });
  });

  it("versões anteriores em pasta própria (opcional); lixeira fica fora", async () => {
    const { db, ctx, typeId } = await setup();
    const d = docs.createDocument(db, ctx, { name: "Proposta", typeId, file: file("a", "p.pdf") });
    docs.addDocumentVersion(db, ctx, d, file("b", "p2.pdf"));
    const lixo = docs.createDocument(db, ctx, { name: "Velho", typeId, file: file("c", "v.pdf") });
    docs.trashDocument(db, ctx, lixo);
    expect(documentBackupList(db).map((e) => e.target)).toEqual(["Proposta (bbbbbbbb).pdf"]);
    expect(documentBackupList(db, { includeOldVersions: true }).map((e) => e.target)).toEqual([
      "Proposta (bbbbbbbb).pdf",
      "_versões anteriores/Proposta v1 (aaaaaaaa).pdf",
    ]);
  });

  it("nomes seguros e só administrador lista", async () => {
    const { db, ctx, ana } = await setup();
    expect(safeSegment('a/b:c*?"<>| . ')).toBe("a_b_c______");
    expect(safeSegment("CON")).toBe("CON_");
    expect(backupTarget({ folder: [], name: "", filename: "x", sha256: sha("f"), version: 2, current: true })).toBe("documento (ffffffff)");
    expect(() => methods["files.backupList"](db, { ...ctx, userId: ana }, {})).toThrow(/Sem permissão/);
  });

  it("índice CSV para o Excel (BOM, ponto e vírgula, aspas)", async () => {
    const { db, ctx, typeId } = await setup();
    docs.createDocument(db, ctx, { name: 'Contrato "A"; final', typeId, docDate: "2026-10-01", validUntil: "2027-10-01", file: file("a", "c.pdf") });
    const csv = indexCsv(documentBackupList(db));
    expect(csv.startsWith("﻿Arquivo no backup;Documento;Classificação")).toBe(true);
    expect(csv).toContain('"Contrato ""A""; final"');
    expect(csv).toContain(";01/10/2026;01/10/2027;");
  });
});

describe("frequência e retenção", () => {
  it("backup dos documentos: a cada abertura (1 h), diário, semanal, manual", () => {
    const now = new Date("2026-10-26T10:00:00");
    expect(isDocBackupDue({ frequency: "open", lastRunAt: "2026-10-26T09:30:00" }, now)).toBe(false);
    expect(isDocBackupDue({ frequency: "open", lastRunAt: "2026-10-26T08:59:00" }, now)).toBe(true);
    expect(isDocBackupDue({ frequency: "daily", lastRunAt: "2026-10-26T01:00:00" }, now)).toBe(false);
    expect(isDocBackupDue({ frequency: "daily", lastRunAt: "2026-10-25T23:00:00" }, now)).toBe(true);
    expect(isDocBackupDue({ frequency: "manual", lastRunAt: null }, now)).toBe(false);
    expect(isFullVerifyDue({ fullVerifyWeekly: true, lastFullVerifyAt: "2026-10-20T10:00:00" }, now)).toBe(false);
    expect(isFullVerifyDue({ fullVerifyWeekly: true, lastFullVerifyAt: "2026-10-19T09:00:00" }, now)).toBe(true);
  });

  it("retenção apaga só os automáticos mais antigos do tipo certo", () => {
    const names = [
      "diario_conectcrm-backup-auto-2026-10-20T08-00-00-000Z.sqlite",
      "diario_conectcrm-backup-auto-2026-10-22T08-00-00-000Z.sqlite",
      "diario_conectcrm-backup-auto-2026-10-21T08-00-00-000Z.sqlite",
      "conectcrm-backup-2026-10-01T08-00-00-000Z.sqlite",
      "Semanal_conectcrm-backup-auto-2026-10-11_2026-10-17T08-00-00-000Z.sqlite",
      "ConectCRM - Documentos",
    ];
    expect(backupsToPrune(names, "daily", 2)).toEqual(["diario_conectcrm-backup-auto-2026-10-20T08-00-00-000Z.sqlite"]);
    expect(backupsToPrune(names, "daily", 0)).toEqual([]);
    expect(backupsToPrune(names, "weekly", 1)).toEqual([]);
  });
});
