import test from 'node:test';
import assert from 'node:assert/strict';
import { PollingService, buildIncomingQuery } from '../../../src/processing/polling.ts';

test('builds an inbox query after the startup watermark and excludes processed mail', () => {
  assert.equal(buildIncomingQuery(1_700_000_123_999), 'after:1700000123 -label:"JEVmail/Processed"');
});

test('initializes a missing watermark without processing existing inbox mail', async () => {
  let state:any={accountEmail:'me@example.com',startupWatermarkMs:0,processedLabelId:'processed',paused:false,needsReconnect:false};
  let listCalls=0;
  const repos:any={installation:{get(){return state;},patch(x:any){state={...state,...x};}}};
  const gmail:any={async listMessages(){listCalls++;return{messages:[{id:'old',threadId:'t'}]};}};
  const processor:any={async processMessage(){throw new Error('not reached');}};
  const service=new PollingService({gmail,repos,processor,now:()=>123456789});
  assert.equal(await service.initializeWatermark(),123456789);
  assert.equal(state.startupWatermarkMs,123456789);
  assert.equal(listCalls,0);
});

test('pause and reconnect-required states keep poller alive without processor work', async () => {
  for(const [patch,status] of [[{paused:true},'paused'],[{needsReconnect:true},'needs_reconnect']] as const){
    let calls=0;
    const repos:any={installation:{get(){return{startupWatermarkMs:1000,processedLabelId:'processed',...patch} as any;}}};
    const gmail:any={async listMessages(){throw new Error('not reached');}};
    const processor:any={async processMessage(){calls++;return'processed';}};
    const service=new PollingService({gmail,repos,processor});
    const result=await service.pollOnce();
    assert.equal(result.status,status);
    assert.equal(calls,0);
  }
});

test('paginates eligible inbox mail and stops cleanly when processing is deferred', async () => {
  const queries:any[]=[]; const processed:string[]=[];
  const repos:any={installation:{get(){return{startupWatermarkMs:2_000_000,processedLabelId:'processed',paused:false,needsReconnect:false};}}};
  const gmail:any={async listMessages(q:any){queries.push(q); if(!q.pageToken)return{messages:[{id:'m1',threadId:'t1'},{id:'m2',threadId:'t2'}],nextPageToken:'p2'}; return{messages:[{id:'m3',threadId:'t3'}]};}};
  const processor:any={async processMessage(id:string){processed.push(id); return id==='m2'?'deferred':'processed';}};
  const service=new PollingService({gmail,repos,processor});
  const result=await service.pollOnce();
  assert.equal(result.status,'deferred');
  assert.deepEqual(processed,['m1','m2']);
  assert.equal(queries.length,1);
  assert.deepEqual(queries[0].labelIds,['INBOX']);
  assert.match(queries[0].q,/after:2000/);
  assert.match(queries[0].q,/JEVmail\/Processed/);
});

test('records last poll status for dashboard observability',async()=>{
  let patched:any=null;
  const repos:any={installation:{get(){return{startupWatermarkMs:1000,processedLabelId:'processed',paused:true,needsReconnect:false};},patch(x:any){patched=x;}}};
  const service=new PollingService({gmail:{listMessages:async()=>{throw new Error('not reached');}} as any,repos,processor:{processMessage:async()=> 'processed'} as any,now:()=>9999});
  await service.pollOnce();
  assert.deepEqual(patched,{lastPollAt:9999,lastPollStatus:'paused'});
});

test('revoked Gmail authorization pauses processing and marks reconnect required',async()=>{
  let state:any={startupWatermarkMs:1000,processedLabelId:'processed',paused:false,needsReconnect:false};
  const patches:any[]=[];
  const repos:any={installation:{get(){return state;},patch(x:any){patches.push(x);state={...state,...x};}},error:{add(){}}};
  const authError:any=new Error('invalid_grant');authError.status=401;
  const service=new PollingService({gmail:{async listMessages(){throw authError;}} as any,repos,processor:{processMessage:async()=> 'processed'} as any,now:()=>777});
  const result=await service.pollOnce();
  assert.equal(result.status,'needs_reconnect');
  assert.equal(state.needsReconnect,true);
  assert.equal(state.lastPollStatus,'needs_reconnect');
});
