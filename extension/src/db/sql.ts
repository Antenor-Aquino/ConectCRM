// Helpers finos sobre o SQLite em WebAssembly (`one`, `many`, `run`,
// `withTransaction`). `DatabaseSync` é o pedaço da API que o CRM usa; quem o
// implementa é o adaptador do SQLite oficial (sqliteDb.ts), que no navegador
// grava direto no OPFS a cada transação.
export type SqlValue = string | number | null | Uint8Array;

export interface Statement {
  bind(values: SqlValue[]): unknown;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): unknown;
}

export interface DatabaseSync {
  prepare(sql: string): Statement;
  run(sql: string, params?: SqlValue[]): unknown;
  /** Resultado no formato { columns, values } (um item quando há linhas). */
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  getRowsModified(): number;
  /** Função escalar em JS chamável no SQL (ex.: normalização da busca do GED). */
  createFunction(name: string, fn: (...args: SqlValue[]) => SqlValue): void;
  /** Cópia do banco inteiro em bytes (backup). */
  export(): Uint8Array;
  close(): void;
}

let txDepth = 0;

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
  return db.getRowsModified();
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
    return result;
  } catch (err) {
    txDepth--;
    db.exec("ROLLBACK");
    throw err;
  }
}
