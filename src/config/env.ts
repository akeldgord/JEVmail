export type EnvIssue = { path: string[]; message: string };
export type AppEnv = {
  APP_URL: string; AUTH_SECRET: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string;
  JEVMODEL_API_KEY: string; JEV_MODEL: string; APP_ENCRYPTION_KEY: string; JEV_BASE_URL: string;
  DATABASE_PATH: string; POLL_INTERVAL_SECONDS: number; MAX_PER_MINUTE: number; MAX_PER_HOUR: number;
  MAX_PER_DAY: number; BACKLOG_BATCH_SIZE: number; DAILY_SPEND_CENTS?: number;
};
export type EnvParseResult = { success: true; data: AppEnv } | { success: false; error: { issues: EnvIssue[] } };

const required = ['APP_URL','AUTH_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','JEVMODEL_API_KEY','JEV_MODEL','APP_ENCRYPTION_KEY'] as const;
const positiveInt = (value: string | undefined, fallback: number) => {
  const n = value == null || value === '' ? fallback : Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function parseEnv(input: Record<string, string | undefined>): EnvParseResult {
  const issues: EnvIssue[] = [];
  for (const key of required) if (!input[key]?.trim()) issues.push({ path: [key], message: `${key} is required` });
  if (issues.length) return { success: false, error: { issues } };
  const spend = input.DAILY_SPEND_CENTS ? positiveInt(input.DAILY_SPEND_CENTS, 0) : undefined;
  return { success: true, data: {
    APP_URL: input.APP_URL!, AUTH_SECRET: input.AUTH_SECRET!, GOOGLE_CLIENT_ID: input.GOOGLE_CLIENT_ID!,
    GOOGLE_CLIENT_SECRET: input.GOOGLE_CLIENT_SECRET!, JEVMODEL_API_KEY: input.JEVMODEL_API_KEY!,
    JEV_MODEL: input.JEV_MODEL!, APP_ENCRYPTION_KEY: input.APP_ENCRYPTION_KEY!,
    JEV_BASE_URL: input.JEV_BASE_URL?.trim() || 'https://jevmodel.org',
    DATABASE_PATH: input.DATABASE_PATH?.trim() || './data/jevmail.db',
    POLL_INTERVAL_SECONDS: positiveInt(input.POLL_INTERVAL_SECONDS, 60),
    MAX_PER_MINUTE: positiveInt(input.MAX_PER_MINUTE, 30), MAX_PER_HOUR: positiveInt(input.MAX_PER_HOUR, 300),
    MAX_PER_DAY: positiveInt(input.MAX_PER_DAY, 2000), BACKLOG_BATCH_SIZE: positiveInt(input.BACKLOG_BATCH_SIZE, 25),
    DAILY_SPEND_CENTS: spend && spend > 0 ? spend : undefined,
  }};
}

export function requireEnv(input: Record<string, string | undefined> = process.env): AppEnv {
  const result = parseEnv(input);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.issues.map(i => i.path[0]).join(', ')}`);
  return result.data;
}
