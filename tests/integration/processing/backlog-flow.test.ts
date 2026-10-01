import test from 'node:test';
import assert from 'node:assert/strict';
import { BacklogManager } from '../../../src/processing/backlog.ts';

test('completed items stay immutable while later backlog items can use a newly active config',async()=>{
  const rows=new Map<number,any>();let next=0;const backlog={create(x:any){const r={id:++next,...x};rows.set(r.id,r);return r;},get(i:number){return rows.get(i);},update(i:number,x:any){rows.set(i,{...rows.get(i),...x});},addFailure(){},listFailureIds(){return[];}};
  let remaining=['m1','m2'];
  const gmail:any={async listMessages(q:any){return{messages:remaining.slice(0,q.maxResults).map(id=>({id,threadId:'t'})),resultSizeEstimate:remaining.length};}};
  let active='config-a';const used:Record<string,string>={};
  const processor:any={async processMessage(id:string){used[id]=active;remaining=remaining.filter(x=>x!==id);return'processed';}};
  const repos:any={backlog,usage:{listSince(){return[];}},installation:{get(){return{backlogBatchSize:1};}}};
  const manager=new BacklogManager({gmail,repos,processor,now:()=>1});
  const job=await manager.createBacklogJob({kind:'all'});
  await manager.runBacklogBatch(job.id);active='config-b';await manager.runBacklogBatch(job.id);
  assert.deepEqual(used,{m1:'config-a',m2:'config-b'});
});
