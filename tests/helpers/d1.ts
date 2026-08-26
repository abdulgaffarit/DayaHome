/**
 * A D1Database implementation backed by better-sqlite3.
 *
 * The whole data layer takes `D1Database` as a parameter rather than importing
 * the binding, which lets these tests run the REAL queries — real SQL, real
 * CHECK constraints, real partial unique indexes — against a real SQLite engine
 * rather than against a mock that would happily accept anything.
 *
 * Only the surface the application actually uses is implemented.
 */
import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

export interface TestDb {
  db: D1Database;
  raw: Database.Database;
  close(): void;
}

export function createTestDatabase(): TestDb {
  const raw = new Database(":memory:");
  // D1 enforces foreign keys; better-sqlite3 does not by default.
  raw.pragma("foreign_keys = ON");

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  return { db: wrap(raw), raw, close: () => raw.close() };
}

function wrap(raw: Database.Database): D1Database {
  const database = {
    prepare(sql: string) {
      return makeStatement(raw, sql, []);
    },
    async batch<T>(statements: PreparedLike[]): Promise<D1Result<T>[]> {
      // D1 runs a batch inside an implicit transaction; mirror that so tests
      // exercise the same atomicity the production code relies on.
      const run = raw.transaction((list: PreparedLike[]) => list.map((s) => s.runSync()));
      return run(statements) as D1Result<T>[];
    },
    async exec(sql: string) {
      raw.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      throw new Error("dump() is not supported by the test D1 shim");
    },
    withSession() {
      throw new Error("withSession() is not supported by the test D1 shim");
    },
  };
  return database as unknown as D1Database;
}

interface PreparedLike {
  runSync(): D1Result;
}

function makeStatement(raw: Database.Database, sql: string, params: unknown[]) {
  const statement = {
    bind(...next: unknown[]) {
      return makeStatement(raw, sql, next);
    },

    async first<T>(column?: string): Promise<T | null> {
      const prepared = raw.prepare(sql);
      // better-sqlite3 refuses `.get()` on a statement that returns no rows,
      // which is exactly what `UPDATE ... RETURNING` looks like to it.
      if (!prepared.reader) {
        prepared.run(...(params as never[]));
        return null;
      }
      const row = prepared.get(...(params as never[])) as Record<string, unknown> | undefined;
      if (row === undefined) return null;
      return (column ? (row[column] as T) : (row as T)) ?? null;
    },

    async all<T>(): Promise<D1Result<T>> {
      const prepared = raw.prepare(sql);
      if (!prepared.reader) {
        const info = prepared.run(...(params as never[]));
        return {
          results: [],
          success: true,
          meta: metaFrom(info),
        } as unknown as D1Result<T>;
      }
      const results = prepared.all(...(params as never[])) as T[];
      return {
        results,
        success: true,
        meta: { changes: 0, last_row_id: 0, rows_read: results.length, rows_written: 0 },
      } as unknown as D1Result<T>;
    },

    async run<T>(): Promise<D1Result<T>> {
      return statement.runSync() as D1Result<T>;
    },

    runSync(): D1Result {
      const prepared = raw.prepare(sql);
      if (prepared.reader) {
        const results = prepared.all(...(params as never[]));
        return {
          results,
          success: true,
          meta: { changes: 0, last_row_id: 0, rows_read: results.length, rows_written: 0 },
        } as unknown as D1Result;
      }
      const info = prepared.run(...(params as never[]));
      return { results: [], success: true, meta: metaFrom(info) } as unknown as D1Result;
    },

    async raw<T>(): Promise<T[]> {
      return raw.prepare(sql).raw().all(...(params as never[])) as T[];
    },
  };

  return statement as unknown as D1PreparedStatement & PreparedLike;
}

function metaFrom(info: Database.RunResult) {
  return {
    changes: info.changes,
    last_row_id: Number(info.lastInsertRowid),
    rows_read: 0,
    rows_written: info.changes,
    duration: 0,
  };
}
