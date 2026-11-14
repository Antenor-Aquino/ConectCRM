// Reexporta o que os testes da DPS usam e um leitor de linha cru (para conferir contadores).
export { createIssuer, nfseDraftForCard, nfsePending, reserveDpsNumber, saveNfseDraft, updateIssuer } from "../src/db/nfse";
import { one, type DatabaseSync } from "../src/db/sql";
export const getRowForTest = (db: DatabaseSync, table: string, id: string) => one<Record<string, unknown>>(db, `SELECT * FROM ${table} WHERE id = ?`, id)!;
