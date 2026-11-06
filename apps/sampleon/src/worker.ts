/** Background work: outbox delivery, due batches, automatic batch scheduling. */
import type { Config } from './config';
import type { Db } from './db';
import type { Supply360Client } from './supply360';
import { deliverOutbox } from './modules/events';
import { outboxSigner } from './modules/inbound';
import { runDueBatches, scheduleAutoBatches } from './modules/launch';

export async function tick(db: Db, cfg: Config, supply: Supply360Client) {
  const scheduled = await scheduleAutoBatches(db, cfg);
  const batches = await runDueBatches(db, cfg, supply);
  let delivered = 0;
  for (let i = 0; i < 10; i++) {
    const n = await deliverOutbox(db, (id) => outboxSigner(db, id));
    delivered += n;
    if (n === 0) break;
  }
  return { scheduled, batches, delivered };
}

export function startWorker(db: Db, cfg: Config, supply: Supply360Client, log: (e: unknown) => void) {
  let stopped = false;
  let running = false;
  const timer = setInterval(async () => {
    if (stopped || running) return;
    running = true;
    try { await tick(db, cfg, supply); } catch (e) { log(e); } finally { running = false; }
  }, cfg.workerIntervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
