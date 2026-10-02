import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRateLimitStatus } from '../../../src/services/dashboard-service.ts';

test('rate-limit status exposes live usage caps reason and reset time',()=>{
  const now=Date.UTC(2026,9,2,2,30,0);
  const events=Array.from({length:293},(_,i)=>({
    kind:'classification',
    inputTokens:100,
    costCents:null,
    createdAt:now-3_000_000+i
  }));
  const repos:any={
    installation:{get(){return{
      maxPerMinute:30,maxPerHour:300,maxPerDay:2000,
      deferReason:'per_hour',deferUntil:now+4*60_000
    };}},
    usage:{listSince(){return events;}}
  };
  const status=buildRateLimitStatus(repos,now);
  assert.equal(status?.deferred,true);
  assert.equal(status?.reason,'per_hour');
  assert.equal(status?.deferUntil,now+4*60_000);
  assert.deepEqual(status?.windows.find(w=>w.key==='hour'),{key:'hour',used:293,cap:300});
  assert.equal(status?.nearLimit,true);
});
