import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Not allowed') => new HttpError(403, m);
export const conflict = (m: string, d?: unknown) => new HttpError(409, m, d);

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export type Actor =
  | { kind: 'client'; id: string; system: 'SUPPLY360' | 'PROJEXA' | 'ZAPX' | 'EXTERNAL' }
  | { kind: 'user'; id: string; role: Role; organizationId: string | null; name: string };

export const ROLES = ['supply_admin', 'supply_approver', 'supply_manager', 'viewer', 'org_viewer'] as const;
export type Role = (typeof ROLES)[number];

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    actor?: Actor;
  }
}

export const actorOf = (req: FastifyRequest): Actor => {
  if (!req.actor) throw new HttpError(401, 'Sign in or sign the request');
  return req.actor;
};
export const actorId = (a: Actor) => (a.kind === 'client' ? `client:${a.id}` : `user:${a.id}`);

/** Staff roles allowed to do something; clients are checked separately by the route. */
export function requireRole(a: Actor, roles: Role[]): asserts a is Extract<Actor, { kind: 'user' }> {
  if (a.kind !== 'user' || !roles.includes(a.role)) throw forbidden(`Needs one of: ${roles.join(', ')}`);
}

export const sendError = (reply: FastifyReply, e: unknown) => {
  if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message, details: e.details });
  reply.log.error(e);
  return reply.code(500).send({ error: 'Internal error' });
};
