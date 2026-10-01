import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dashboardAccessState } from '../../../src/auth/google-account.ts';
import { buildDashboardOverview } from '../../../src/services/dashboard-service.ts';

test('dashboard access redirects anonymous users, blocks account mismatch, and surfaces reconnect state',()=>{
  const installation={accountEmail:'me@example.com',encryptedRefreshToken:'token',needsReconnect:false,paused:false};
  assert.equal(dashboardAccessState(null,installation),'sign_in');
  assert.equal(dashboardAccessState('other@example.com',installation),'account_mismatch');
  assert.equal(dashboardAccessState('me@example.com',{...installation,needsReconnect:true}),'needs_reconnect');
  assert.equal(dashboardAccessState('ME@example.com',installation),'connected');
});

test('overview reports today classifications, correction rate, usage and spend availability without message bodies',()=>{
  const start=Date.UTC(2026,8,29);const now=start+12*3600000;
  const repos:any={
    installation:{get(){return{paused:false,needsReconnect:false,lastPollAt:now-1000,lastPollStatus:'ok',dailySpendCents:100};}},
    audit:{list(){return[{messageId:'m1',processedAt:now-100,labelId:'reply_needed'},{messageId:'m2',processedAt:now-200,labelId:'receipt_record'},{messageId:'old',processedAt:start-1,labelId:'fyi_no_action'}];},listCorrections(id:string){return id==='m2'?[{toLabelId:'receipt_record'}]:[];}},
    usage:{listSince(){return[{kind:'classification',inputTokens:100,costCents:3,createdAt:now-500},{kind:'classification',inputTokens:50,costCents:2,createdAt:now-400}];}},
    backlog:{list(){return[{status:'running',total:10,processed:4,failed:1}];}}
  };
  const overview=buildDashboardOverview(repos,now);
  assert.equal(overview.classificationsToday,2);assert.equal(overview.correctionsToday,1);assert.equal(overview.correctionRate,0.5);
  assert.equal(overview.inputTokensToday,150);assert.equal(overview.spendCentsToday,5);assert.equal(overview.spendAvailable,true);
  assert.equal(overview.pendingBacklog,5);assert.equal(overview.failedBacklog,1);assert.equal('body' in overview,false);
});

test('dashboard operational state persists last poll metadata and lists backlog jobs',async()=>{
  const { createDatabase }=await import('../../../src/db/client.ts');
  const { createRepositories }=await import('../../../src/db/repositories/index.ts');
  const db=createDatabase(':memory:');const repos:any=createRepositories(db);
  repos.installation.upsert({accountEmail:'me@example.com',startupWatermarkMs:1,processedLabelId:'p',paused:false,needsReconnect:false});
  repos.installation.patch({lastPollAt:123,lastPollStatus:'ok'});
  assert.equal(repos.installation.get().lastPollAt,123);assert.equal(repos.installation.get().lastPollStatus,'ok');
  repos.backlog.create({rangeJson:'{}',status:'pending',total:3,processed:0,failed:0,createdAt:1,updatedAt:1});
  assert.equal(repos.backlog.list(5).length,1);
  db.close();
});

test('dashboard overview exposes categorized recent processing errors only',()=>{
  const repos:any={installation:{get(){return{paused:false,needsReconnect:false};}},audit:{list(){return[];},listCorrections(){return[];}},usage:{listSince(){return[];}},backlog:{list(){return[];}},error:{list(){return[{stage:'poll',category:'gmail_auth',messageId:null,createdAt:10}];}}};
  const overview=buildDashboardOverview(repos,20);
  assert.deepEqual(overview.recentErrors,[{stage:'poll',category:'gmail_auth',messageId:null,createdAt:10}]);
});

test('blocked dashboard states must not render protected child content',()=>{
  const source=fs.readFileSync(new URL('../../../src/app/dashboard/layout.tsx', import.meta.url),'utf8');
  assert.match(source,/if\s*\(ctx\.state\s*!==\s*['"]connected['"]\)\s*return/);
});

test('triage does not render persisted sender/subject and offers on-demand live Gmail preview',()=>{
  const source=fs.readFileSync(new URL('../../../src/app/dashboard/triage/page.tsx', import.meta.url),'utf8');
  assert.equal(source.includes('a.subject'),false);
  assert.equal(source.includes('a.sender'),false);
  assert.match(source,/LiveMessagePreview/);
});

test('overview renders recent categorized processing errors',()=>{
  const source=fs.readFileSync(new URL('../../../src/app/dashboard/page.tsx', import.meta.url),'utf8');
  assert.match(source,/recentErrors/);
});
