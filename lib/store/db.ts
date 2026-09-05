/* ============================================================
   The database seam.

   Everything above this file writes Postgres SQL and nothing else.
   Two clients satisfy it — node-postgres against a real server, and
   PGlite in tests — but they run the SAME statements, because the
   moment two dialects exist the two stop agreeing and the
   disagreement surfaces as a bug in production only.

   That is the whole reason this is a client seam rather than a query
   builder or a per-engine implementation. A builder would let the
   two diverge without anybody noticing; sharing the literal SQL means
   a statement that works in a test is the statement that runs live.

   PGlite is real Postgres compiled to WASM, so tests exercise
   Postgres semantics rather than an approximation of them. What it
   cannot exercise is concurrency: it is a single connection, so the
   advisory lock below is correct by construction and by reasoning,
   not by observation. That limit is stated at the lock itself.
   ============================================================ */

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/**
 * The minimum a store needs.
 *
 * Deliberately small. Anything richer would be a place for the two clients to
 * differ, and every method here has an obvious meaning in both.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /**
   * Run one or more statements with no parameters — schema, essentially.
   *
   * Separate from query() because it is a different wire protocol, not a
   * convenience. Parameterised statements go through the extended protocol,
   * which carries exactly one command; a multi-statement DDL block sent that
   * way is rejected outright. Keeping them apart means the schema can stay one
   * readable block instead of an array of strings nobody keeps in order.
   */
  exec(sql: string): Promise<void>;
  /** Run fn inside a transaction, rolling back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * A 64-bit key for pg_advisory_xact_lock, derived from a string.
 *
 * Computed here rather than with Postgres's hashtext(), which is an internal
 * function with no compatibility promise across versions. A lock key that
 * silently changed meaning on an upgrade would stop serialising the thing it
 * exists to serialise, and nothing would fail — the chain would just start
 * forking under load.
 *
 * FNV-1a, in BigInt so the arithmetic does not lose the top bits the way
 * Number would past 2^53.
 */
export function lockKey(value: string): bigint {
  const PRIME = 1099511628211n;
  const MASK = (1n << 64n) - 1n;
  let hash = 14695981039346656037n;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash ^ BigInt(value.charCodeAt(i))) * PRIME) & MASK;
  }
  // pg advisory locks take a signed bigint; fold the unsigned value into range
  return BigInt.asIntN(64, hash);
}

/**
 * Serialise everything in `fn` against everybody else using the same key.
 *
 * The Postgres answer to SQLite's BEGIN IMMEDIATE, and the reason the hash
 * chain cannot fork: appendEvent derives seq and prevHash from the tail, so
 * two writers reading the same tail would mint two events claiming the same
 * position.
 *
 * The transaction-scoped variant specifically. pg_advisory_lock is held by the
 * SESSION, and a transaction pooler hands the same session to unrelated
 * clients — so a session-scoped lock taken through pgbouncer would be released
 * by somebody else's commit, or never released at all. The xact variant is
 * released with the transaction, which is the only form that is safe behind a
 * pooler, and Vercel means a pooler.
 *
 * SELECT ... FOR UPDATE on the head row would not do: on the first append
 * there is no row to lock, so the two writers that matter most — the ones
 * racing to create seq 0 — would not be serialised at all.
 */
export async function withChainLock<T>(tx: Db, key: string, fn: () => Promise<T>): Promise<T> {
  await tx.query("SELECT pg_advisory_xact_lock($1)", [lockKey(key).toString()]);
  return fn();
}

/* ---------- node-postgres, for a real server ---------- */

type PgPool = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
};
type PgClient = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(): void;
};

class PgDb implements Db {
  constructor(private readonly pool: PgPool) {}

  async exec(sql: string): Promise<void> {
    // no params, so this goes through the simple protocol and may be multi-statement
    await this.pool.query(sql);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    /* One client for the whole transaction. Running the statements through the
       pool would scatter them across connections, so BEGIN and COMMIT would
       apply to different sessions and the advisory lock would be taken and
       released by a connection doing none of the work. */
    const tx: Db = {
      query: async <U>(sql: string, params: unknown[] = []) => {
        const r = await client.query(sql, params);
        return { rows: r.rows as U[], rowCount: r.rowCount ?? 0 };
      },
      exec: async (sql: string) => {
        await client.query(sql);
      },
      transaction: () => {
        throw new Error("transactions do not nest here");
      },
      close: async () => {},
    };

    try {
      await client.query("BEGIN");
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/* ---------- PGlite, for tests ---------- */

type PgliteInstance = {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
};

class PgliteDb implements Db {
  /* Transactions queue behind each other.

     PGlite is a single connection, so two overlapping transactions would
     interleave their statements on it — BEGIN, BEGIN, INSERT, COMMIT — and
     neither would be isolated from the other. A real server gives each
     transaction its own connection and the advisory lock does the
     serialising; here there is nothing to serialise against, so the harness
     has to provide it.

     This is not a shortcut around the test. It is what makes the double
     behave like the thing it stands in for: without it, a concurrency test
     fails for a reason that exists only in the test, which teaches the reader
     something false about the code under it. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly pg: PgliteInstance) {}

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pg.query(sql, params);
    return { rows: r.rows as T[], rowCount: r.affectedRows ?? (r.rows as T[]).length };
  }

  async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await this.pg.query("BEGIN");
      try {
        const result = await fn(this);
        await this.pg.query("COMMIT");
        return result;
      } catch (e) {
        await this.pg.query("ROLLBACK").catch(() => {});
        throw e;
      }
    });
    // the queue must not stop on a failure, or one rollback wedges every
    // transaction after it
    this.queue = run.catch(() => {});
    return run;
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

/* ---------- choosing one ---------- */

let cached: Db | null = null;

/**
 * The database this process should use.
 *
 * A DATABASE_URL means a real server. Its absence means tests, and an
 * in-process Postgres — never a silent fallback to something that looks like
 * it worked. A store that quietly wrote to a throwaway database in production
 * would lose the audit chain and report success doing it.
 */
export async function db(): Promise<Db> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      // Vercel runs many short-lived instances; a large pool per instance
      // exhausts the server's connection limit long before it helps
      max: Number(process.env.PGPOOL_MAX ?? 3),
      ssl: url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
    });
    cached = new PgDb(pool as unknown as PgPool);
    return cached;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production");
  }

  const { PGlite } = await import("@electric-sql/pglite");
  cached = new PgliteDb((await PGlite.create()) as unknown as PgliteInstance);
  return cached;
}

/** Tests replace the database between cases. */
export function setDb(next: Db | null): void {
  cached = next;
}
