/**
 * Two kinds of caller: services (PROJEXA, ZAPX, SUPPLY360, external hosts) sign every request
 * (§5.0), and staff use bearer tokens bound to a role (§8.1).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HEADER_CLIENT, verifyRequest } from '@sampledge/contracts';
import { many, one, type Db } from './db';
import { HttpError, type Actor, type Role } from './http';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newStaffToken = () => `son_${randomBytes(24).toString('base64url')}`;

interface ClientRow { id: string; system: Extract<Actor, { kind: 'client' }>['system']; secrets: string[]; active: boolean }

export async function authenticate(db: Db, req: FastifyRequest): Promise<Actor | undefined> {
  if (req.headers[HEADER_CLIENT]) {
    const clients = await many<ClientRow>(db, 'SELECT id, system, secrets, active FROM service_clients WHERE id = $1', [String(req.headers[HEADER_CLIENT])]);
    const result = verifyRequest({
      headers: req.headers,
      method: req.method,
      path: req.url,
      body: req.rawBody ?? '',
      secretsFor: (id) => clients.filter((c) => c.id === id && c.active).flatMap((c) => c.secrets),
    });
    if (!result.ok) throw new HttpError(401, result.reason);
    const c = clients[0]!;
    return { kind: 'client', id: c.id, system: c.system };
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const u = await one<{ id: string; role: Role; organization_id: string | null; name: string }>(db, 'SELECT id, role, organization_id, name FROM users WHERE token_hash = $1 AND active', [hashToken(auth.slice(7).trim())]);
    if (!u) throw new HttpError(401, 'Unknown or revoked token');
    return { kind: 'user', id: u.id, role: u.role, organizationId: u.organization_id, name: u.name };
  }
  return undefined;
}

/** Keep the raw body (signatures cover it) and resolve the caller on every /api request. */
export function installAuth(app: FastifyInstance, db: Db) {
  app.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1_000_000 }, (req, body, done) => {
    req.rawBody = body as string;
    if (!body) return done(null, {});
    try { done(null, JSON.parse(body as string)); } catch { done(new HttpError(400, 'Body is not valid JSON'), undefined); }
  });
  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    if (req.url.startsWith('/api/v1/s2s/outcome')) return; // signed by its own contract
    req.actor = await authenticate(db, req);
  });
}
