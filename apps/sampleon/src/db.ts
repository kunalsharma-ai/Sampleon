import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type Db = Pool;
export type Tx = PoolClient;
export type Queryable = Pool | PoolClient;

export const createPool = (url: string) => new Pool({ connectionString: url, max: 10 });

export async function tx<T>(pool: Pool, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export async function one<T extends QueryResultRow>(q: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await q.query<T>(sql, params);
  return r.rows[0] ?? null;
}

export async function many<T extends QueryResultRow>(q: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await q.query<T>(sql, params)).rows;
}
