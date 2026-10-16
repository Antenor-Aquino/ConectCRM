// Helpers finos sobre sql.js (SQLite em WebAssembly), mesma assinatura da
// gestao-financeira-extensao (`one`, `many`, `run`, `withTransaction`).
//
// A persistência não fica aqui: quem abre o banco (o documento offscreen, ou
// os testes) registra um `onWrite` que é chamado após cada escrita - o
// offscreen usa isso para gravar o snapshot no IndexedDB (debounced).
import type { Database } from "sql.js";

export type DatabaseSync = Database;
export type SqlValue = string | number | null | Uint8Array;

let onWrite: ((db: DatabaseSync) => void) | null = null;
let txDepth = 0;

export function setWriteListener(fn: ((db: DatabaseSync) => void) | null): void {
  onWrite = fn;
}

function notifyWrite(db: DatabaseSync): void {
  if (txDepth === 0) onWrite?.(db);
}

export function one<T>(db: DatabaseSync, sql: string, ...params: SqlValue[]): T | undefined {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject() as T;
    return undefined;
  } finally {
    stmt.free();
  }
}

export function many<T>(db: DatabaseSync, sql: string, ...params: SqlValue[]): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function run(db: DatabaseSync, sql: string, ...params: SqlValue[]): number {
  db.run(sql, params);
  const changes = db.getRowsModified();
  notifyWrite(db);
  return changes;
}

/** Transação aninhável (só a mais externa faz BEGIN/COMMIT). */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (txDepth > 0) return fn();
  db.exec("BEGIN");
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec("COMMIT");
    notifyWrite(db);
    return result;
  } catch (err) {
    txDepth--;
    db.exec("ROLLBACK");
    throw err;
  }
}
