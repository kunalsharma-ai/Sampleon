/**
 * SUPPLY360 eligibility & delivery API client (§5.1). SAMPLEON never stores profiles: every
 * count, selection and eligibility check is a call to SUPPLY360.
 */
import { signRequest, type AttributeDef, type Criterion } from '@sampledge/contracts';
import type { Config } from './config';
import type { Db } from './db';

export interface CountQuery {
  country: string;
  criteria: Criterion[];
  exclude?: { audienceRequestIds?: string[]; surveyIds?: string[]; respondentRefs?: string[] };
  fatigue?: { maxInvites: number; windowDays: number };
  activeWithinDays?: number;
}
export interface PanelCounts { eligible: number; reachable: number }
export interface CountResult { eligible: number; reachable: number; missingProfile: Record<string, number>; byPanel: Record<string, PanelCounts> }
export interface SelectResult { respondents: { respondentRef: string; panel: string; country: string }[] }
export interface CheckResult { eligible: boolean; reasons: string[]; quotaIds: string[]; country: string | null; consented: boolean }
export interface DeliveryItem {
  invitationId: string;
  respondentRef: string;
  panel: string;
  cardUrl: string;
  title: string;
  loiMinutes: number;
  rewardPoints: number;
  expiresAt: string;
  channels: ('card' | 'email')[];
}
export interface DeliveryResult { results: { invitationId: string; status: 'delivered' | 'suppressed'; reason?: string }[] }

export class Supply360Error extends Error {
  constructor(message: string, public status: number | null) { super(message); }
}

export class Supply360Client {
  constructor(private cfg: Config, private db: Db) {}

  get connected() { return Boolean(this.cfg.supply360Url && this.cfg.supply360Secret); }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, requestId?: string): Promise<T> {
    if (!this.connected) throw new Supply360Error('SUPPLY360 is not connected (SUPPLY360_URL and SUPPLY360_SECRET)', 503);
    const fullPath = `/api/v1/s2s/supply${path}`;
    const url = new URL(this.cfg.supply360Url!);
    const signedPath = `${url.pathname.replace(/\/+$/, '')}${fullPath}`;
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = {
      ...signRequest({ clientId: this.cfg.supply360ClientId, secret: this.cfg.supply360Secret!, method, path: signedPath, body: payload }),
      ...(payload ? { 'content-type': 'application/json' } : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${url.origin}${signedPath}`, { method, headers, body: payload || undefined, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      await this.recordError(`${method} ${path}`, `Network error: ${(e as Error).message}`, requestId);
      throw new Supply360Error(`SUPPLY360 unreachable: ${(e as Error).message}`, null);
    }
    const text = await res.text();
    if (!res.ok) {
      await this.recordError(`${method} ${path}`, `HTTP ${res.status}: ${text.slice(0, 500)}`, requestId);
      throw new Supply360Error(`SUPPLY360 ${method} ${path} failed with ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async recordError(operation: string, error: string, requestId?: string) {
    await this.db.query('INSERT INTO integration_errors (system, operation, request_id, error) VALUES ($1,$2,$3,$4)', ['SUPPLY360', operation, requestId ?? null, error]).catch(() => undefined);
  }

  attributes() { return this.call<{ attributes: AttributeDef[] }>('GET', '/attributes').then((r) => r.attributes); }
  count(q: CountQuery, requestId?: string) { return this.call<CountResult>('POST', '/eligibility/count', q, requestId); }
  select(q: CountQuery & { limit: number; panel?: string }, requestId?: string) { return this.call<SelectResult>('POST', '/eligibility/select', q, requestId); }
  check(q: { respondentRef: string; criteria: Criterion[]; quotas?: { id: string; conditions: Criterion[] }[] }, requestId?: string) {
    return this.call<CheckResult>('POST', '/eligibility/check', q, requestId);
  }
  deliver(audienceRequestId: string, surveyId: string, items: DeliveryItem[]) { return this.call<DeliveryResult>('POST', '/deliveries', { audienceRequestId, surveyId, items }, audienceRequestId); }
}
