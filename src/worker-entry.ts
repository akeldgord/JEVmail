import { requireEnv } from './config/env.ts';
import { getRuntimeRepositories } from './db/runtime.ts';
import { createRuntimeApp } from './services/runtime-app.ts';
import { PollingService } from './processing/polling.ts';
import { ConfiguredWorkerService, WorkerCycle,runWorker } from './processing/worker.ts';
import { mergeDefaultTaxonomy } from './services/setup-service.ts';

const env=requireEnv();
const repos=getRuntimeRepositories();
let defaultsChecked=false;
const service=new ConfiguredWorkerService({
  repos,
  createCycle(){
    const app=createRuntimeApp();
    const polling=new PollingService({gmail:app.gmail,repos:app.repos,processor:app.processor});
    const cycle=new WorkerCycle({polling,backlog:app.backlog,repos:app.repos});
    return{async pollOnce(){if(!defaultsChecked){await mergeDefaultTaxonomy({gmail:app.gmail,repos:app.repos});defaultsChecked=true;}return cycle.pollOnce();}};
  }
});
const controller=new AbortController();
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>controller.abort());

await runWorker(service,{
  signal:controller.signal,
  intervalMs:()=>service.intervalMs(env.POLL_INTERVAL_SECONDS*1000),
  onStatus(status){
    if(status.status==='error'){
      const at=Date.now();
      repos.installation.patch?.({lastPollAt:at,lastPollStatus:'error'});
      repos.error.add({stage:'worker',category:'worker_error',provider:'app',status:null,detail:'Worker cycle failed. Check container logs for the local runtime error.',messageId:null,createdAt:at});
      console.error('[worker] worker_error');
    }
  }
});
