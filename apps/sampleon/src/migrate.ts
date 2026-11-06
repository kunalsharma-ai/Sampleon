import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { createPool } from './db';
import { loadConfig } from './config';

export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/** Apply every migrations/*.sql not yet applied, in name order, each in its own transaction. */
export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('SELECT pg_advisory_lock(424242)');
  try {
    const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const f of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      } finally {
        c.release();
      }
    }
    return applied;
  } finally {
    await pool.query('SELECT pg_advisory_unlock(424242)');
  }
}

if (require.main === module) {
  const pool = createPool(loadConfig().databaseUrl);
  migrate(pool)
    .then((a) => { console.log(a.length ? `Applied ${a.join(', ')}` : 'Up to date'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
