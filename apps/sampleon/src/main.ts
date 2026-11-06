import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';
import { startWorker } from './worker';

async function main() {
  const cfg = loadConfig();
  const db = createPool(cfg.databaseUrl);
  await migrate(db);
  const { app, supply } = buildApp(db, cfg);
  const stop = process.env.WORKER_INLINE === 'false' ? () => undefined : startWorker(db, cfg, supply, (e) => app.log.error(e));
  await app.listen({ port: cfg.port, host: process.env.HOST ?? '0.0.0.0' });
  const shutdown = async () => { stop(); await app.close(); await db.end(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
