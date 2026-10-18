// Adaptador do SQLite oficial em WebAssembly (@sqlite.org/sqlite-wasm, API
// "oo1") para a interface `DatabaseSync` que o CRM usa. No navegador o banco
// é aberto no OPFS pelo worker do banco; nos testes e para validar backups,
// em memória.
import type { Database, PreparedStatement, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import type { DatabaseSync, SqlValue, Statement } from "./sql";

class SqliteStatement implements Statement {
  constructor(private readonly stmt: PreparedStatement) {}
  bind(values: SqlValue[]): this {
    if (values.length) this.stmt.bind(values);
    return this;
  }
  step(): boolean {
    return this.stmt.step();
  }
  getAsObject(): Record<string, unknown> {
    return this.stmt.get({});
  }
  free(): void {
    this.stmt.finalize();
  }
}

export class SqliteDb implements DatabaseSync {
  constructor(
    private readonly sqlite3: Sqlite3Static,
    readonly db: Database,
  ) {}
  prepare(sql: string): Statement {
    return new SqliteStatement(this.db.prepare(sql));
  }
  run(sql: string, params: SqlValue[] = []): void {
    this.db.exec({ sql, bind: params.length ? params : undefined });
  }
  exec(sql: string): { columns: string[]; values: unknown[][] }[] {
    const values: SqlValue[][] = [];
    const columns: string[] = [];
    this.db.exec({ sql, rowMode: "array", resultRows: values, columnNames: columns });
    return values.length ? [{ columns, values }] : [];
  }
  getRowsModified(): number {
    return Number(this.db.changes());
  }
  createFunction(name: string, fn: (...args: SqlValue[]) => SqlValue): void {
    this.db.createFunction(name, (_ctx: number, ...args) => fn(...(args.map((a) => (typeof a === "bigint" ? Number(a) : a)) as SqlValue[])), { arity: fn.length, deterministic: true });
  }
  export(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db);
  }
  close(): void {
    this.db.close();
  }
}

/** Banco em memória, vazio ou a partir dos bytes de um arquivo SQLite. */
export function memoryDb(sqlite3: Sqlite3Static, bytes?: Uint8Array | null): SqliteDb {
  const db = new sqlite3.oo1.DB(":memory:", "c");
  if (bytes?.length) {
    const { capi, wasm } = sqlite3;
    const p = wasm.allocFromTypedArray(bytes);
    const rc = capi.sqlite3_deserialize(db.pointer!, "main", p, bytes.length, bytes.length, capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
    if (rc) {
      db.close();
      throw new Error(`Arquivo SQLite inválido (código ${rc}).`);
    }
  }
  return new SqliteDb(sqlite3, db);
}
