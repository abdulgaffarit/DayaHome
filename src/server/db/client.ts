/**
 * Thin, fully-parameterised query helpers over D1.
 *
 * Every call goes through `db.prepare(...).bind(...)`, so user input is never
 * concatenated into SQL. Where a query needs a dynamic number of placeholders
 * (an `IN (...)` list) the placeholders are generated from the array length and
 * the values are still bound — see `placeholders()`.
 *
 * These helpers take the `D1Database` as an argument rather than importing the
 * binding, which is what lets the whole data layer run against better-sqlite3
 * in tests.
 */

export type Bindable = string | number | null;

export async function queryOne<T>(
  db: D1Database,
  sql: string,
  params: Bindable[] = [],
): Promise<T | null> {
  const row = await db
    .prepare(sql)
    .bind(...params)
    .first<T>();
  return row ?? null;
}

export async function queryAll<T>(
  db: D1Database,
  sql: string,
  params: Bindable[] = [],
): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return result.results ?? [];
}

export async function execute(
  db: D1Database,
  sql: string,
  params: Bindable[] = [],
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

/** Number of rows a write actually touched — used for idempotency checks. */
export function changes(result: D1Result): number {
  return result.meta?.changes ?? 0;
}

export interface Statement {
  sql: string;
  params?: Bindable[];
}

/**
 * Runs several statements as one D1 batch.
 *
 * D1 wraps a batch in an implicit transaction, which is the strongest atomicity
 * primitive available on the platform (D1 has no interactive BEGIN/COMMIT over
 * the binding API). Multi-statement invariants — "mark the payment PAID *and*
 * activate the unlock" — must go through here.
 */
export async function batch(db: D1Database, statements: Statement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  const prepared = statements.map((s) => db.prepare(s.sql).bind(...(s.params ?? [])));
  return db.batch(prepared);
}

/** `placeholders(3)` → `"?, ?, ?"`. The count comes from code, never from input. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/** Convenience for the 0/1 integers D1 uses for booleans. */
export const bool = (v: boolean): number => (v ? 1 : 0);
export const fromBool = (v: number | null | undefined): boolean => v === 1;

/**
 * Detects a UNIQUE-constraint violation.
 *
 * The duplicate-unlock and duplicate-favorite guarantees are enforced by unique
 * indexes; the application catches the resulting error and treats it as
 * "already done" rather than as a failure.
 */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|D1_ERROR.*UNIQUE/i.test(message);
}
