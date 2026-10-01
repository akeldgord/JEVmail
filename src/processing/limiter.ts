export type UsageEvent = {
  kind: string;
  inputTokens?: number | null;
  costCents?: number | null;
  createdAt: number;
};

export type ProcessingLimits = {
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
  dailySpendCents?: number;
};

export type LimitReason = 'per_minute' | 'per_hour' | 'per_day' | 'daily_spend';
export type SpendStatus =
  | { status: 'not_configured' }
  | { status: 'available'; usedCents: number; ceilingCents: number }
  | { status: 'unavailable'; ceilingCents: number };

export type LimitDecision = {
  allowed: boolean;
  reason?: LimitReason;
  counts: { minute: number; hour: number; day: number };
  spend: SpendStatus;
};

type UsageRepository = {
  listSince(ms: number): UsageEvent[] | Promise<UsageEvent[]>;
  add(event: UsageEvent): void | Promise<void>;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function startOfUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export class RateGovernor {
  private readonly usage: UsageRepository;
  private readonly getSettings: () => ProcessingLimits | Promise<ProcessingLimits>;

  constructor(usage: UsageRepository, getSettings: () => ProcessingLimits | Promise<ProcessingLimits>) {
    this.usage = usage;
    this.getSettings = getSettings;
  }

  async canStart(now = Date.now()): Promise<LimitDecision> {
    const settings = await this.getSettings();
    const dayStart = startOfUtcDay(now);
    const earliestNeeded = Math.min(dayStart, now - HOUR_MS);
    const events = (await this.usage.listSince(earliestNeeded)).filter((event) => event.kind === 'classification');
    const minute = events.filter((event) => event.createdAt > now - MINUTE_MS && event.createdAt <= now).length;
    const hour = events.filter((event) => event.createdAt > now - HOUR_MS && event.createdAt <= now).length;
    const dayEvents = events.filter((event) => event.createdAt >= dayStart && event.createdAt <= now);
    const day = dayEvents.length;

    let spend: SpendStatus = { status: 'not_configured' };
    if (settings.dailySpendCents != null) {
      const hasUnknownCost = dayEvents.some((event) => event.costCents == null);
      if (hasUnknownCost) {
        spend = { status: 'unavailable', ceilingCents: settings.dailySpendCents };
      } else {
        const usedCents = dayEvents.reduce((sum, event) => sum + (event.costCents ?? 0), 0);
        spend = { status: 'available', usedCents, ceilingCents: settings.dailySpendCents };
      }
    }

    const counts = { minute, hour, day };
    if (minute >= settings.maxPerMinute) return { allowed: false, reason: 'per_minute', counts, spend };
    if (hour >= settings.maxPerHour) return { allowed: false, reason: 'per_hour', counts, spend };
    if (day >= settings.maxPerDay) return { allowed: false, reason: 'per_day', counts, spend };
    if (spend.status === 'available' && spend.usedCents >= spend.ceilingCents) {
      return { allowed: false, reason: 'daily_spend', counts, spend };
    }
    return { allowed: true, counts, spend };
  }

  async recordUsage(event: UsageEvent): Promise<void> {
    await this.usage.add(event);
  }
}
