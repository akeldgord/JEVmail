import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerCycle } from '../../../src/processing/worker.ts';

test('worker gives incoming mail priority then advances one active backlog batch',async()=>{
  const order:string[]=[];
  const polling:any={async pollOnce(){order.push('incoming');return{status:'ok',examined:1,processed:1,failures:0};}};
  const backlog:any={async runBacklogBatch(id:number){order.push(`backlog:${id}`);}};
  const repos:any={backlog:{list(){return[{id:7,status:'running'},{id:8,status:'pending'}];}}};
  const result=await new WorkerCycle({polling,backlog,repos}).pollOnce();
  assert.equal(result.status,'ok');assert.deepEqual(order,['incoming','backlog:7']);
});

test('worker does not advance backlog when normal processing is paused, disconnected, or rate-deferred',async()=>{
  for(const status of ['paused','needs_reconnect','deferred'] as const){let runs=0;const cycle=new WorkerCycle({polling:{pollOnce:async()=>({status,examined:0,processed:0,failures:0})} as any,backlog:{runBacklogBatch:async()=>{runs++;}} as any,repos:{backlog:{list:()=>[{id:1,status:'pending'}]}} as any});await cycle.pollOnce();assert.equal(runs,0);}
});

test('worker reports only a generic error category when a cycle throws',async()=>{
  const { runWorker }=await import('../../../src/processing/worker.ts');
  const controller=new AbortController();let captured:any;
  await runWorker({pollOnce:async()=>{throw new Error('secret provider response');}},{signal:controller.signal,intervalMs:1,onStatus(status){captured=status;controller.abort();}});
  assert.equal(captured.status,'error');
  assert.equal(captured.error,'worker_error');
});

test('configured worker waits for OAuth setup and reads poll interval dynamically',async()=>{
  const mod:any=await import('../../../src/processing/worker.ts');
  assert.equal(typeof mod.ConfiguredWorkerService,'function');
  let state:any=null;let cycles=0;
  const service=new mod.ConfiguredWorkerService({repos:{installation:{get(){return state;}}},createCycle(){cycles++;return{pollOnce:async()=>({status:'ok',examined:0,processed:0,failures:0})};}});
  assert.equal((await service.pollOnce()).status,'not_ready');assert.equal(cycles,0);
  state={encryptedRefreshToken:'enc',needsReconnect:false,pollIntervalSeconds:17};
  assert.equal((await service.pollOnce()).status,'ok');assert.equal(cycles,1);assert.equal(service.intervalMs(60000),17000);
  state={...state,needsReconnect:true,pollIntervalSeconds:9};
  assert.equal((await service.pollOnce()).status,'needs_reconnect');assert.equal(cycles,1);assert.equal(service.intervalMs(60000),9000);
});


test('incoming poller counts never mutate backlog job counters',async()=>{
  const job:any={id:9,status:'pending',processed:0,total:10,failed:0};
  const repos:any={
    backlog:{list(){return[job];}},
    installation:{patch(){}}
  };
  const cycle=new WorkerCycle({
    polling:{pollOnce:async()=>({status:'ok',examined:3,processed:3,failures:0})} as any,
    backlog:{runBacklogBatch:async()=>job} as any,
    repos
  });
  await cycle.pollOnce();
  assert.equal(job.processed,0);
  assert.equal(job.total,10);
});

test('configured worker exposes active defer state and auto-resumes deferred backlog after reset',async()=>{
  const mod:any=await import('../../../src/processing/worker.ts');
  let state:any={encryptedRefreshToken:'enc',needsReconnect:false,pollIntervalSeconds:60,deferReason:'per_hour',deferUntil:Date.now()+60_000};
  const job:any={id:4,status:'deferred',processed:0,total:10,failed:0,updatedAt:0};
  let cycles=0;
  const repos:any={
    installation:{get(){return state;},patch(x:any){state={...state,...x};}},
    backlog:{list(){return[job];},update(_id:number,x:any){Object.assign(job,x);}}
  };
  const service=new mod.ConfiguredWorkerService({
    repos,
    createCycle(){cycles++;return{pollOnce:async()=>({status:'ok',examined:0,processed:0,failures:0})};}
  });
  assert.equal((await service.pollOnce()).status,'deferred');
  assert.equal(cycles,0);
  assert.equal(state.lastPollStatus,'deferred');
  state.deferUntil=Date.now()-1;
  assert.equal((await service.pollOnce()).status,'ok');
  assert.equal(cycles,1);
  assert.equal(state.deferReason,null);
  assert.equal(state.deferUntil,null);
  assert.equal(job.status,'pending');
});
