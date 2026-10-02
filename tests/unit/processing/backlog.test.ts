import test from 'node:test';
import assert from 'node:assert/strict';
import { BacklogManager, buildBacklogQuery } from '../../../src/processing/backlog.ts';

const now=Date.UTC(2026,8,29,12,0,0);

function memoryBacklog(){
  const rows=new Map<number,any>();const failures=new Map<number,Set<string>>();let id=0;
  return{
    create(x:any){const row={id:++id,...x};rows.set(row.id,row);return row;},
    get(i:number){return rows.get(i)??null;},
    update(i:number,x:any){rows.set(i,{...rows.get(i),...x});},
    addFailure(jobId:number,messageId:string){const set=failures.get(jobId)??new Set<string>();set.add(messageId);failures.set(jobId,set);},
    listFailureIds(jobId:number){return [...(failures.get(jobId)??new Set<string>())];}
  };
}

test('builds backlog queries for presets custom ranges and all inbox while excluding processed mail',()=>{
  assert.equal(buildBacklogQuery({kind:'days',days:30},now),`after:${Math.floor((now-30*86400000)/1000)} -label:"JEVmail/Processed"`);
  assert.equal(buildBacklogQuery({kind:'days',days:90},now),`after:${Math.floor((now-90*86400000)/1000)} -label:"JEVmail/Processed"`);
  assert.equal(buildBacklogQuery({kind:'custom',startMs:10000,endMs:20000},now),'after:10 before:20 -label:"JEVmail/Processed"');
  assert.equal(buildBacklogQuery({kind:'all'},now),'-label:"JEVmail/Processed"');
});

test('backlog estimate counts actual paginated messages and applies documented input-token pricing',async()=>{
  let calls=0;let creates=0;
  const gmail:any={async listMessages(q:any){
    assert.deepEqual(q.labelIds,['INBOX']);calls++;
    if(!q.pageToken)return{messages:[{id:'a',threadId:'t'},{id:'b',threadId:'t'}],nextPageToken:'p2',resultSizeEstimate:1};
    return{messages:[{id:'c',threadId:'t'}],resultSizeEstimate:1};
  }};
  const repos:any={backlog:{create(){creates++;}},usage:{listSince(){return[{kind:'classification',inputTokens:500,costCents:null,createdAt:1}];}},installation:{get(){return{backlogBatchSize:25};}}};
  const manager=new BacklogManager({gmail,repos,processor:{processMessage:async()=> 'processed'} as any,now:()=>now});
  const estimate=await manager.estimateBacklog({kind:'all'});
  assert.equal(calls,2);
  assert.equal(estimate.eligibleMessages,3);
  assert.equal(estimate.estimatedCalls,3);
  assert.equal(estimate.estimatedInputTokens,1500);
  assert.equal(estimate.costEstimateBasis,'pricing_estimate');
  assert.ok(Math.abs((estimate.estimatedCostUsd??0)-0.000063)<1e-12);
  assert.equal(creates,0);
});

test('fresh backlog total is exact and processed never exceeds total',async()=>{
  const backlog=memoryBacklog();
  const gmail:any={async listMessages(){return{messages:[{id:'a',threadId:'t'},{id:'b',threadId:'t'},{id:'c',threadId:'t'}],resultSizeEstimate:1};}};
  const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:10};}}};
  const manager=new BacklogManager({gmail,repos,processor:{processMessage:async()=> 'processed'} as any,now:()=>now,concurrency:8});
  const job=await manager.createBacklogJob({kind:'all'});
  assert.equal(job.total,3);
  const after=await manager.runBacklogBatch(job.id);
  assert.equal(after.status,'completed');
  assert.equal(after.processed,3);
  assert.equal(after.total,3);
  assert.ok(after.processed<=after.total);
});

test('deferred outcome stops after the in-flight chunk without starting later chunks',async()=>{
  const backlog=memoryBacklog();
  const messages=['a','b','c','d'].map(id=>({id,threadId:'t'}));
  const gmail:any={async listMessages(){return{messages};}};
  const seen:string[]=[];
  const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:4,deferUntil:now+60_000};}}};
  const manager=new BacklogManager({
    gmail,repos,now:()=>now,concurrency:2,
    processor:{async processMessage(id:string){seen.push(id);return id==='a'?'deferred':'processed';}} as any
  });
  const job=await manager.createBacklogJob({kind:'all'});
  const result=await manager.runBacklogBatch(job.id);
  assert.deepEqual(seen.sort(),['a','b']);
  assert.equal(result.processed,1);
  assert.equal(result.status,'deferred');
});

test('deferred backlog does no work before reset time',async()=>{
  const backlog=memoryBacklog();
  const gmail:any={async listMessages(){return{messages:[{id:'a',threadId:'t'}]};}};
  let calls=0;
  const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:10,deferUntil:now+60_000};}}};
  const manager=new BacklogManager({gmail,repos,processor:{async processMessage(){calls++;return'processed';}} as any,now:()=>now});
  const job=backlog.create({rangeJson:JSON.stringify({kind:'all'}),status:'deferred',total:1,processed:0,failed:0,createdAt:now,updatedAt:now});
  const result=await manager.runBacklogBatch(job.id);
  assert.equal(result.status,'deferred');
  assert.equal(calls,0);
});

test('permanent failures are counted once and recorded',async()=>{
  const backlog=memoryBacklog();
  const gmail:any={async listMessages(){return{messages:[{id:'bad',threadId:'t'},{id:'good',threadId:'t'}]};}};
  const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:2};}}};
  const manager=new BacklogManager({gmail,repos,processor:{async processMessage(id:string){return id==='bad'?'failed_permanent':'processed';}} as any,now:()=>now,concurrency:2});
  const job=await manager.createBacklogJob({kind:'all'});
  const result=await manager.runBacklogBatch(job.id);
  assert.equal(result.failed,1);
  assert.equal(result.processed,1);
  assert.equal(result.status,'completed');
  assert.deepEqual(backlog.listFailureIds(job.id),['bad']);
});
