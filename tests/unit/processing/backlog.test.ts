import test from 'node:test';
import assert from 'node:assert/strict';
import { BacklogManager, buildBacklogQuery } from '../../../src/processing/backlog.ts';

const now=Date.UTC(2026,8,29,12,0,0);

test('builds backlog queries for presets, custom ranges, and all inbox while excluding processed mail',()=>{
  assert.equal(buildBacklogQuery({kind:'days',days:30},now),`after:${Math.floor((now-30*86400000)/1000)} -label:"JEVmail/Processed"`);
  assert.equal(buildBacklogQuery({kind:'days',days:90},now),`after:${Math.floor((now-90*86400000)/1000)} -label:"JEVmail/Processed"`);
  assert.equal(buildBacklogQuery({kind:'days',days:365},now),`after:${Math.floor((now-365*86400000)/1000)} -label:"JEVmail/Processed"`);
  assert.equal(buildBacklogQuery({kind:'custom',startMs:10000,endMs:20000},now),'after:10 before:20 -label:"JEVmail/Processed"');
  assert.equal(buildBacklogQuery({kind:'all'},now),'-label:"JEVmail/Processed"');
});

test('estimation uses the documented TypeSafe input-token rate when provider cost metadata is unavailable',async()=>{
  let creates=0;
  const gmail:any={async listMessages(q:any){assert.deepEqual(q.labelIds,['INBOX']);return{messages:[],resultSizeEstimate:42};}};
  const repos:any={backlog:{create(){creates++;}},usage:{listSince(){return[{kind:'classification',inputTokens:500,costCents:null,createdAt:1}];}},installation:{get(){return{backlogBatchSize:25};}}};
  const manager=new BacklogManager({gmail,repos,processor:{processMessage:async()=> 'processed'} as any,now:()=>now});
  const estimate=await manager.estimateBacklog({kind:'days',days:30});
  assert.equal(estimate.eligibleMessages,42);
  assert.equal(estimate.estimatedCalls,42);
  assert.equal(estimate.estimatedInputTokens,21000);
  assert.equal(estimate.costEstimateUnavailable,false);
  assert.equal(estimate.costEstimateBasis,'pricing_estimate');
  assert.equal(estimate.estimatedCostUsd,0.000882);
  assert.equal(creates,0);
});

test('job lifecycle processes at most configured batch size and can pause resume and cancel',async()=>{
  const rows=new Map<number,any>();let id=0;const processed:string[]=[];
  const backlog={create(x:any){const row={id:++id,...x};rows.set(row.id,row);return row;},get(i:number){return rows.get(i)??null;},update(i:number,x:any){rows.set(i,{...rows.get(i),...x});},addFailure(){},listFailureIds(){return[];}};
  const gmail:any={async listMessages(q:any){const count=Math.min(q.maxResults,5);return{messages:Array.from({length:count},(_,i)=>({id:`m${i+1}`,threadId:'t'})),resultSizeEstimate:5};}};
  const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:2};}}};
  const manager=new BacklogManager({gmail,repos,processor:{async processMessage(mid:string){processed.push(mid);return'processed';}} as any,now:()=>now});
  const job=await manager.createBacklogJob({kind:'all'});
  assert.equal(job.status,'pending');assert.equal(job.total,5);
  const after=await manager.runBacklogBatch(job.id);
  assert.equal(processed.length,2);assert.equal(after.processed,2);assert.equal(after.status,'running');
  assert.equal(manager.pauseBacklog(job.id).status,'paused');
  assert.equal(manager.resumeBacklog(job.id).status,'pending');
  assert.equal(manager.cancelBacklog(job.id).status,'cancelled');
  const before=processed.length; await manager.runBacklogBatch(job.id); assert.equal(processed.length,before);
});

test('a deferred processor outcome stops the batch without consuming later messages',async()=>{
  const rows=new Map<number,any>();let id=0;const backlog={create(x:any){const r={id:++id,...x};rows.set(r.id,r);return r;},get(i:number){return rows.get(i);},update(i:number,x:any){rows.set(i,{...rows.get(i),...x});},addFailure(){},listFailureIds(){return[];}};
  const gmail:any={async listMessages(){return{messages:[{id:'a',threadId:'t'},{id:'b',threadId:'t'}],resultSizeEstimate:2};}};
  const seen:string[]=[];const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:10};}}};
  const manager=new BacklogManager({gmail,repos,processor:{async processMessage(id:string){seen.push(id);return'deferred';}} as any,now:()=>now});
  const job=await manager.createBacklogJob({kind:'all'});const result=await manager.runBacklogBatch(job.id);
  assert.deepEqual(seen,['a']);assert.equal(result.processed,0);assert.equal(result.status,'running');
});

test('does not complete early when Gmail resultSizeEstimate undercounts eligible mail',async()=>{
  const rows=new Map<number,any>();let id=0;const backlog={create(x:any){const r={id:++id,...x,failedMessageIds:[]};rows.set(r.id,r);return r;},get(i:number){return rows.get(i);},update(i:number,x:any){rows.set(i,{...rows.get(i),...x});},addFailure(){},listFailureIds(){return[];}};
  let calls=0;const gmail:any={async listMessages(q:any){calls++;if(calls===1)return{messages:[],resultSizeEstimate:1};if(calls===2)return{messages:[{id:'a',threadId:'t'},{id:'b',threadId:'t'}],nextPageToken:'more'};if(calls===3)return{messages:[{id:'c',threadId:'t'}]};return{messages:[]};}};
  const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:2};}}};
  const manager=new BacklogManager({gmail,repos,processor:{processMessage:async()=> 'processed'} as any,now:()=>now});
  const job=await manager.createBacklogJob({kind:'all'});
  const afterFirst=await manager.runBacklogBatch(job.id);
  assert.equal(afterFirst.processed,2);
  assert.equal(afterFirst.status,'running');
  const afterSecond=await manager.runBacklogBatch(job.id);
  assert.equal(afterSecond.status,'completed');
  assert.equal(afterSecond.total,3);
});

test('permanent backlog failures are recorded once and skipped so later messages can progress',async()=>{
  const rows=new Map<number,any>();const failures=new Map<number,Set<string>>();let id=0;
  const backlog={create(x:any){const r={id:++id,...x};rows.set(r.id,r);return r;},get(i:number){return rows.get(i);},update(i:number,x:any){rows.set(i,{...rows.get(i),...x});},addFailure(jobId:number,messageId:string){const s=failures.get(jobId)??new Set();s.add(messageId);failures.set(jobId,s);},listFailureIds(jobId:number){return [...(failures.get(jobId)??new Set())];}};
  let listCall=0;const gmail:any={async listMessages(q:any){listCall++;if(listCall===1)return{messages:[],resultSizeEstimate:3};if(listCall===2)return{messages:[{id:'bad',threadId:'t'},{id:'good1',threadId:'t'}],nextPageToken:'more'};if(listCall===3)return{messages:[{id:'bad',threadId:'t'},{id:'good2',threadId:'t'}]};return{messages:[]};}};
  const seen:string[]=[];const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:2};}}};
  const manager=new BacklogManager({gmail,repos,processor:{async processMessage(mid:string){seen.push(mid);return mid==='bad'?'failed_permanent':'processed';}} as any,now:()=>now});
  const job=await manager.createBacklogJob({kind:'all'});
  const first=await manager.runBacklogBatch(job.id);assert.equal(first.failed,1);
  await manager.runBacklogBatch(job.id);
  assert.equal(seen.filter(x=>x==='bad').length,1);
  assert.equal(seen.includes('good2'),true);
});
