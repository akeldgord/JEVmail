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
  retryAt?: number;
  counts: { minute: number; hour: number; day: number };
  spend: SpendStatus;
};

type UsageRepository = {
  listSince(ms: number): UsageEvent[] | Promise<UsageEvent[]>;
  add(event: UsageEvent): void | Promise<void>;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function startOfUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function oldestReset(events:UsageEvent[],windowMs:number,now:number):number{
  const active=events.filter(e=>e.createdAt>now-windowMs&&e.createdAt<=now).sort((a,b)=>a.createdAt-b.createdAt);
  return active.length?active[0].createdAt+windowMs:now+windowMs;
}

export class RateGovernor {
  private readonly usage: UsageRepository;
  private readonly getSettings: () => ProcessingLimits | Promise<ProcessingLimits>;
  private reservations:number[]=[];
  private gate:Promise<void>=Promise.resolve();

  constructor(usage: UsageRepository, getSettings: () => ProcessingLimits | Promise<ProcessingLimits>) {
    this.usage = usage;
    this.getSettings = getSettings;
  }

  private async exclusive<T>(fn:()=>Promise<T>):Promise<T>{
    const previous=this.gate;
    let release!:()=>void;
    this.gate=new Promise<void>(resolve=>{release=resolve;});
    await previous;
    try{return await fn();}finally{release();}
  }

  async canStart(now = Date.now()): Promise<LimitDecision> {
    return this.exclusive(async()=>{
      const settings = await this.getSettings();
      const dayStart = startOfUtcDay(now);
      this.reservations=this.reservations.filter(ts=>ts>=dayStart);
      const earliestNeeded = Math.min(dayStart, now - HOUR_MS);
      const persisted = (await this.usage.listSince(earliestNeeded)).filter((event) => event.kind === 'classification');
      const reserved:UsageEvent[]=this.reservations.map(createdAt=>({kind:'classification',createdAt}));
      const events=[...persisted,...reserved];
      const minuteEvents = events.filter((event) => event.createdAt > now - MINUTE_MS && event.createdAt <= now);
      const hourEvents = events.filter((event) => event.createdAt > now - HOUR_MS && event.createdAt <= now);
      const dayEvents = events.filter((event) => event.createdAt >= dayStart && event.createdAt <= now);
      const minute = minuteEvents.length;
      const hour = hourEvents.length;
      const day = dayEvents.length;

      let spend: SpendStatus = { status: 'not_configured' };
      if (settings.dailySpendCents != null) {
        const persistedDayEvents=persisted.filter(event=>event.createdAt>=dayStart&&event.createdAt<=now);
        const hasUnknownCost = persistedDayEvents.some((event) => event.costCents == null);
        if (hasUnknownCost) {
          spend = { status: 'unavailable', ceilingCents: settings.dailySpendCents };
        } else {
          const usedCents = persistedDayEvents.reduce((sum, event) => sum + (event.costCents ?? 0), 0);
          spend = { status: 'available', usedCents, ceilingCents: settings.dailySpendCents };
        }
      }

      const counts = { minute, hour, day };
      if (minute >= settings.maxPerMinute) return { allowed: false, reason: 'per_minute', retryAt:oldestReset(minuteEvents,MINUTE_MS,now), counts, spend };
      if (hour >= settings.maxPerHour) return { allowed: false, reason: 'per_hour', retryAt:oldestReset(hourEvents,HOUR_MS,now), counts, spend };
      if (day >= settings.maxPerDay) return { allowed: false, reason: 'per_day', retryAt:dayStart+DAY_MS, counts, spend };
      if (spend.status === 'available' && spend.usedCents >= spend.ceilingCents) {
        return { allowed: false, reason: 'daily_spend', retryAt:dayStart+DAY_MS, counts, spend };
      }
      this.reservations.push(now);
      return { allowed: true, counts, spend };
    });
  }

  async recordUsage(event: UsageEvent): Promise<void> {
    if(event.kind==='classification'&&this.reservations.length)this.reservations.shift();
    await this.usage.add(event);
  }
}
