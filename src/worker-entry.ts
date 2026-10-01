import { requireEnv } from './config/env.ts';
import { getRuntimeRepositories } from './db/runtime.ts';
import { createRuntimeApp } from './services/runtime-app.ts';
import { PollingService } from './processing/polling.ts';
import { ConfiguredWorkerService, WorkerCycle,runWorker } from './processing/worker.ts';
const env=requireEnv();const repos=getRuntimeRepositories();
const service=new ConfiguredWorkerService({repos,createCycle(){const app=createRuntimeApp();const polling=new PollingService({gmail:app.gmail,repos:app.repos,processor:app.processor});return new WorkerCycle({polling,backlog:app.backlog,repos:app.repos});}});
const controller=new AbortController();for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>controller.abort());
await runWorker(service,{signal:controller.signal,intervalMs:()=>service.intervalMs(env.POLL_INTERVAL_SECONDS*1000),onStatus(status){if(status.status==='error')console.error('[worker] worker_error');}});
