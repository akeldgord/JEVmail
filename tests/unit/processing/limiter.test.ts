import test from 'node:test';
import assert from 'node:assert/strict';
import { RateGovernor, type UsageEvent } from '../../../src/processing/limiter.ts';

class MemoryUsageRepo {
  events: UsageEvent[] = [];
  listSince(ms: number) { return this.events.filter((event) => event.createdAt >= ms); }
  add(event: UsageEvent) { this.events.push(event); }
}

const t = Date.UTC(2026, 8, 29, 18, 0, 0);

function makeGovernor(repo = new MemoryUsageRepo(), overrides: Partial<{maxPerMinute:number;maxPerHour:number;maxPerDay:number;dailySpendCents?:number}> = {}) {
  let settings = { maxPerMinute: 2, maxPerHour: 3, maxPerDay: 4, ...overrides };
  return {
    repo,
    governor: new RateGovernor(repo, () => settings),
    setSettings(next: typeof settings) { settings = next; },
  };
}

test('enforces minute, hour, and day limits only for new classifications', async () => {
  const { repo, governor } = makeGovernor();
  repo.events.push(
    { kind: 'classification', createdAt: t - 10_000, inputTokens: 10, costCents: 1 },
    { kind: 'classification', createdAt: t - 20_000, inputTokens: 10, costCents: 1 },
  );
  let decision = await governor.canStart(t);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'per_minute');
  assert.equal(decision.retryAt, t - 20_000 + 60_000);

  decision = await governor.canStart(t + 61_000);
  assert.equal(decision.allowed, true);

  await governor.recordUsage({ kind: 'classification', createdAt: t + 61_000, inputTokens: 10, costCents: 1 });
  decision = await governor.canStart(t + 62_000);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'per_hour');
  assert.equal(decision.retryAt, t - 20_000 + 60 * 60 * 1000);

  decision = await governor.canStart(t + 60 * 60 * 1000 + 1);
  assert.equal(decision.allowed, true);
  await governor.recordUsage({ kind: 'classification', createdAt: t + 60 * 60 * 1000 + 1, inputTokens: 10, costCents: 1 });
  decision = await governor.canStart(t + 60 * 60 * 1000 + 2);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'per_day');
  assert.equal(decision.retryAt, Date.UTC(2026,8,30,0,0,0));
});

test('changing settings takes effect without rewriting historical usage', async () => {
  const { repo, governor, setSettings } = makeGovernor();
  repo.events.push(
    { kind: 'classification', createdAt: t - 10_000, inputTokens: 10, costCents: 1 },
    { kind: 'classification', createdAt: t - 20_000, inputTokens: 10, costCents: 1 },
  );
  assert.equal((await governor.canStart(t)).reason, 'per_minute');
  setSettings({ maxPerMinute: 5, maxPerHour: 5, maxPerDay: 5 });
  assert.equal((await governor.canStart(t)).allowed, true);
  assert.equal(repo.events.length, 2);
});

test('blocks at a configured daily spend ceiling when provider cost is reliable', async () => {
  const { repo, governor } = makeGovernor(undefined, { maxPerMinute: 10, maxPerHour: 10, maxPerDay: 10, dailySpendCents: 25 });
  repo.events.push(
    { kind: 'classification', createdAt: t - 20_000, inputTokens: 100, costCents: 10 },
    { kind: 'classification', createdAt: t - 10_000, inputTokens: 100, costCents: 15 },
  );
  const decision = await governor.canStart(t);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'daily_spend');
  assert.equal(decision.retryAt, Date.UTC(2026,8,30,0,0,0));
  assert.deepEqual(decision.spend, { status: 'available', usedCents: 25, ceilingCents: 25 });
});

test('reports spend unavailable instead of guessing when usage has no reliable cost', async () => {
  const { repo, governor } = makeGovernor(undefined, { maxPerMinute: 10, maxPerHour: 10, maxPerDay: 10, dailySpendCents: 25 });
  repo.events.push({ kind: 'classification', createdAt: t - 10_000, inputTokens: 100, costCents: null });
  const decision = await governor.canStart(t);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.spend, { status: 'unavailable', ceilingCents: 25 });
});

test('minute and hour limits remain rolling across UTC midnight while daily count resets',async()=>{
  const repo=new MemoryUsageRepo();
  const justAfterMidnight=Date.UTC(2026,8,30,0,0,30);
  repo.events.push({kind:'classification',createdAt:justAfterMidnight-40_000,inputTokens:10,costCents:1}); // previous UTC day
  const governor=new RateGovernor(repo,()=>({maxPerMinute:1,maxPerHour:10,maxPerDay:10}));
  const decision=await governor.canStart(justAfterMidnight);
  assert.equal(decision.allowed,false);assert.equal(decision.reason,'per_minute');assert.equal(decision.counts.day,0);assert.equal(decision.counts.minute,1);
});


test('concurrent canStart calls reserve capacity and cannot overshoot the minute cap',async()=>{
  const repo=new MemoryUsageRepo();
  const governor=new RateGovernor(repo,()=>({maxPerMinute:3,maxPerHour:10,maxPerDay:10}));
  const decisions=await Promise.all(Array.from({length:8},()=>governor.canStart(t)));
  assert.equal(decisions.filter(d=>d.allowed).length,3);
  assert.equal(decisions.filter(d=>!d.allowed&&d.reason==='per_minute').length,5);
});
