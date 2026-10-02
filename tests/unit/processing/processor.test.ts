import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageProcessor } from '../../../src/processing/processor.ts';
import { RetryPolicy, classifyOperationalError, isGmailQuotaError, requiresGmailReconnect } from '../../../src/processing/retry-policy.ts';
import { DEFAULT_TAXONOMY, DEFAULT_GLOBAL_INSTRUCTIONS } from '../../../src/domain/defaults.ts';
import { hashClassifierConfig } from '../../../src/domain/config-version.ts';
import { JevApiError } from '../../../src/classifier/jev-client.ts';

function configuredTaxonomy() {
  const taxonomy = structuredClone(DEFAULT_TAXONOMY);
  for (const label of taxonomy.labels) label.gmailLabelId = `gmail-${label.id}`;
  return taxonomy;
}

function makeHarness(options: { failVisibleOnce?: boolean; failMarkerOnce?: boolean; failAudit?: boolean; persistedAttempt?: boolean } = {}) {
  const taxonomy = configuredTaxonomy();
  const snapshot = { provider:'jev', model:'jev-1.13.0', globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS, taxonomy };
  const configHash = hashClassifierConfig(snapshot);
  const labels = new Set<string>(['INBOX', 'gmail-newsletter_subscription']);
  let visibleFailures = options.failVisibleOnce ? 1 : 0;
  let markerFailures = options.failMarkerOnce ? 1 : 0;
  let classifierCalls = 0;
  const attempts = new Map<string, any>();
  if (options.persistedAttempt) attempts.set('m1', { messageId:'m1', configHash, labelId:'reply_needed', probabilities:{reply_needed:.9}, confidence:.9, provider:'jev', model:'jev-1.13.0', usage:{input_tokens:10}, createdAt:1 });
  const audits: any[] = [];
  const usage: any[] = [];
  const gmail: any = {
    async getMessage(id:string){ return { id, threadId:'t1', labelIds:[...labels], internalDate:1 }; },
    async modifyMessage(_id:string, add:string[], remove:string[] = []) {
      if (add.includes('gmail-reply_needed') && visibleFailures-- > 0) { const error:any = new Error('gmail 503'); error.status = 503; throw error; }
      if (add.includes('processed') && markerFailures-- > 0) { const error:any = new Error('gmail 503'); error.status = 503; throw error; }
      for (const id of remove) labels.delete(id);
      for (const id of add) labels.add(id);
    },
  };
  const classifier: any = { async classify(req:any){ classifierCalls++; return { labelId:'reply_needed', probabilities:{reply_needed:.9,indeterminate:.1}, confidence:.9, provider:'jev', model:req.model, usage:{input_tokens:10}, configHash:req.configHash, idempotencyKey:'k' }; } };
  const repos:any = {
    installation:{ get(){ return { processedLabelId:'processed', paused:false, needsReconnect:false }; } },
    config:{ getActive(){ return { hash:configHash, provider:'jev', model:'jev-1.13.0', globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS, taxonomyJson:JSON.stringify(taxonomy), active:true }; }, get(hash:string){ return hash===configHash ? this.getActive() : null; } },
    attempt:{ getSuccessful(id:string){ return attempts.get(id) ?? null; }, saveSuccess(value:any){ attempts.set(value.messageId,value); } },
    audit:{ complete(value:any){ if(options.failAudit) throw new Error('disk full'); audits.push(value); } },
  };
  const governor:any = { async canStart(){ return { allowed:true, counts:{minute:0,hour:0,day:0}, spend:{status:'not_configured'} }; }, async recordUsage(event:any){ usage.push(event); } };
  const processor = new MessageProcessor({ gmail, classifier, repos, governor, now:()=>1000, loadContext:async()=>({current:{id:'m1',threadId:'t1',internalDate:1,timestampMs:1,labelIds:[],sender:'a@example.com',recipients:['me@example.com'],subject:'Please reply',body:'Can you reply?',attachments:[]},prior:[]}) });
  return { processor, labels, audits, usage, attempts, taxonomy, configHash, get classifierCalls(){return classifierCalls;} };
}

test('classifies once, reconciles to one visible app label, marks processed, audits, and records usage', async () => {
  const h = makeHarness();
  assert.equal(await h.processor.processMessage('m1'), 'processed');
  assert.equal(h.classifierCalls, 1);
  assert.equal(h.labels.has('processed'), true);
  assert.equal(h.labels.has('gmail-reply_needed'), true);
  assert.equal(h.labels.has('gmail-newsletter_subscription'), false);
  assert.equal([...h.labels].filter((id) => id.startsWith('gmail-')).length, 1);
  assert.equal(h.audits.length, 1);
  assert.equal(h.usage.length, 1);

  assert.equal(await h.processor.processMessage('m1'), 'already_processed');
  assert.equal(h.classifierCalls, 1);
});

test('returns deferred without classifier call when rate governor blocks a new inference', async () => {
  const h = makeHarness();
  (h.processor as any).governor = { async canStart(){ return { allowed:false, reason:'per_minute', counts:{minute:2,hour:2,day:2}, spend:{status:'not_configured'} }; }, async recordUsage(){ throw new Error('not reached'); } };
  assert.equal(await h.processor.processMessage('m1'), 'deferred');
  assert.equal(h.classifierCalls, 0);
});

test('reuses saved attempt after visible-label or processed-marker failure without a second classifier call', async () => {
  for (const key of ['failVisibleOnce','failMarkerOnce'] as const) {
    const h = makeHarness({ [key]: true });
    assert.equal(await h.processor.processMessage('m1'), 'failed_transient');
    assert.equal(h.classifierCalls, 1);
    assert.equal(h.attempts.has('m1'), true);
    assert.equal(await h.processor.processMessage('m1'), 'processed');
    assert.equal(h.classifierCalls, 1);
    assert.equal([...h.labels].filter((id) => id.startsWith('gmail-')).length, 1);
  }
});

test('reuses a persisted successful attempt after restart even if active config later changes', async () => {
  const h = makeHarness({ persistedAttempt:true });
  assert.equal(await h.processor.processMessage('m1'), 'processed');
  assert.equal(h.classifierCalls, 0);
  assert.equal(h.labels.has('gmail-reply_needed'), true);
});

test('processed marker defines completion even when local audit commit fails', async () => {
  const h = makeHarness({ failAudit:true });
  assert.equal(await h.processor.processMessage('m1'), 'processed');
  assert.equal(h.labels.has('processed'), true);
  assert.equal(h.classifierCalls, 1);
  assert.equal(await h.processor.processMessage('m1'), 'already_processed');
  assert.equal(h.classifierCalls, 1);
});

test('invalid classifier output is permanent and never writes Gmail labels', async () => {
  const h = makeHarness();
  (h.processor as any).classifier = { async classify(){ return { labelId:'bogus', probabilities:{bogus:1}, confidence:1, provider:'jev', model:'jev-1.13.0', usage:{}, configHash:h.configHash, idempotencyKey:'x' }; } };
  assert.equal(await h.processor.processMessage('m1'), 'failed_permanent');
  assert.equal(h.labels.has('processed'), false);
});

test('retry policy bounds transient attempts and classifies provider/Gmail errors', () => {
  const policy = new RetryPolicy({ maxAttempts:3, baseDelayMs:1000, maxDelayMs:5000 });
  assert.equal(policy.delayForAttempt(1), 1000);
  assert.equal(policy.delayForAttempt(2), 2000);
  assert.equal(policy.delayForAttempt(3), null);
  assert.equal(classifyOperationalError(new JevApiError('rate',429,true)), 'transient');
  assert.equal(classifyOperationalError(new JevApiError('bad',422,false)), 'permanent');
  const gmail503:any = new Error('x'); gmail503.status = 503;
  const gmail401:any = new Error('x'); gmail401.status = 401;
  assert.equal(classifyOperationalError(gmail503), 'transient');
  assert.equal(classifyOperationalError(gmail401), 'permanent');
});

test('Gmail authorization failure marks installation reconnect-required and records a categorized error',async()=>{
  const h=makeHarness();let reconnect=false;const errors:any[]=[];
  (h.processor as any).repos.installation.patch=(x:any)=>{if(x.needsReconnect)reconnect=true;};
  (h.processor as any).repos.error={add:(x:any)=>errors.push(x)};
  (h.processor as any).gmail.getMessage=async()=>{const e:any=new Error('invalid_grant');e.status=401;throw e;};
  assert.equal(await h.processor.processMessage('m1'),'failed_permanent');
  assert.equal(reconnect,true);
  assert.equal(errors.length,1);
  assert.equal(errors[0].category,'gmail_auth');
  assert.equal(errors[0].messageId,'m1');
});


test('Jev classifier failure never triggers Gmail reconnect state',async()=>{
  const h=makeHarness();let reconnect=false;const errors:any[]=[];
  (h.processor as any).repos.installation.patch=(x:any)=>{if(x.needsReconnect)reconnect=true;};
  (h.processor as any).repos.error={add:(x:any)=>errors.push(x)};
  (h.processor as any).classifier={async classify(){throw new JevApiError('invalid TypeSafe API key',401,false);}};
  assert.equal(await h.processor.processMessage('m1'),'failed_permanent');
  assert.equal(reconnect,false);
  assert.equal(errors.length,1);
  assert.equal(errors[0].category,'classifier');
  assert.equal(errors[0].provider,'classifier');
  assert.equal(errors[0].status,401);
});

test('Gmail quota 403 is transient and never triggers reconnect',()=>{
  const quota:any=new Error("Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'");
  quota.status=403;
  quota.errors=[{domain:'usageLimits',reason:'rateLimitExceeded'}];
  quota.response={data:{error:{status:'PERMISSION_DENIED',errors:quota.errors}}};
  assert.equal(isGmailQuotaError(quota),true);
  assert.equal(requiresGmailReconnect(quota),false);
  assert.equal(classifyOperationalError(quota),'transient');
});

test('bare Gmail 403 is not assumed to be an auth failure',()=>{
  const error:any=new Error('Forbidden');
  error.status=403;
  error.response={data:{error:{status:'PERMISSION_DENIED'}}};
  assert.equal(requiresGmailReconnect(error),false);
});


test('rate deferral persists reason reset time and deferred poll status',async()=>{
  const h=makeHarness();
  let state:any={processedLabelId:'processed',paused:false,needsReconnect:false,deferReason:null,deferUntil:null};
  (h.processor as any).repos.installation={
    get(){return state;},
    patch(x:any){state={...state,...x};}
  };
  (h.processor as any).governor={
    async canStart(){return{allowed:false,reason:'per_hour',retryAt:123456,counts:{minute:1,hour:300,day:300},spend:{status:'not_configured'}};},
    async recordUsage(){throw new Error('not reached');}
  };
  assert.equal(await h.processor.processMessage('m1'),'deferred');
  assert.equal(state.deferReason,'per_hour');
  assert.equal(state.deferUntil,123456);
  assert.equal(state.lastPollStatus,'deferred');
  assert.equal(h.classifierCalls,0);
});
