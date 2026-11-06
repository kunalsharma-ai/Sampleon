/** Runtime settings, read once from the environment. */
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

export interface Config {
  databaseUrl: string;
  port: number;
  publicUrl: string;
  supply360Url: string | null;
  supply360ClientId: string;
  supply360Secret: string | null;
  defaultSurveyHost: string;
  workerIntervalMs: number;
  defaultResponseRate: number;
  fatigueMaxInvites: number;
  fatigueWindowDays: number;
  activeWithinDays: number;
  maxRouteHops: number;
  maxBatchSize: number;
  autoBatchIntervalMinutes: number;
  aiProvider: 'rules' | 'anthropic';
  anthropicApiKey: string | null;
  anthropicModel: string;
  panelEndUrl: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 4600}`).replace(/\/+$/, '');
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgresql://sampleon:sampleon@localhost:5432/sampleon',
    port: num(env.PORT, 4600),
    publicUrl,
    supply360Url: env.SUPPLY360_URL ? env.SUPPLY360_URL.replace(/\/+$/, '') : null,
    supply360ClientId: env.SUPPLY360_CLIENT_ID ?? 'sampleon',
    supply360Secret: env.SUPPLY360_SECRET ?? null,
    defaultSurveyHost: env.DEFAULT_SURVEY_HOST ?? 'zapx',
    workerIntervalMs: num(env.WORKER_INTERVAL_MS, 2000),
    defaultResponseRate: num(env.DEFAULT_RESPONSE_RATE, 0.12),
    fatigueMaxInvites: num(env.FATIGUE_MAX_INVITES, 3),
    fatigueWindowDays: num(env.FATIGUE_WINDOW_DAYS, 7),
    activeWithinDays: num(env.ACTIVE_WITHIN_DAYS, 90),
    maxRouteHops: num(env.MAX_ROUTE_HOPS, 3),
    maxBatchSize: num(env.MAX_BATCH_SIZE, 5000),
    autoBatchIntervalMinutes: num(env.AUTO_BATCH_INTERVAL_MINUTES, 60),
    aiProvider: env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY ? 'anthropic' : 'rules',
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
    panelEndUrl: env.PANEL_END_URL ?? null,
  };
}
