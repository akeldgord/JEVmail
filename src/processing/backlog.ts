import type { GmailClient } from '../gmail/types.ts';
import type { MessageProcessor } from './processor.ts';

export type BacklogRange = { kind:'days'; days:30|90|365 } | { kind:'custom'; startMs:number; endMs:number } | { kind:'all' };
export const ESTIMATED_INPUT_USD_PER_MTOK=0.042;
export type BacklogEstimate = {eligibleMessages:number;estimatedCalls:number;estimatedInputTokens:number|null;estimatedCostCents:number|null;estimatedCostUsd:number|null;costEstimateUnavailable:boolean;costEstimateBasis:'provider'|'pricing_estimate'|'unavailable';};
function processedClause(){return '-label:"JEVmail/Processed"';}
export function buildBacklogQuery(range:BacklogRange,now=Date.now()):string{if(range.kind==='all')return processedClause();if(range.kind==='days')return `after:${Math.floor((now-range.days*86_400_000)/1000)} ${processedClause()}`;if(!Number.isFinite(range.startMs)||!Number.isFinite(range.endMs)||range.startMs>=range.endMs)throw new Error('invalid custom backlog range');return `after:${Math.floor(range.startMs/1000)} before:${Math.floor(range.endMs/1000)} ${processedClause()}`;}

type BacklogRepo={create(x:any):any;get(id:number):any;update(id:number,x:any):void;addFailure(jobId:number,messageId:string,kind:string,createdAt:number):void;listFailureIds(jobId:number):string[]};
type UsageRepo={listSince(ms:number):any[]|Promise<any[]>};
type Repos={backlog:BacklogRepo;usage:UsageRepo;installation:{get():any}};

export class BacklogManager{
  private readonly gmail:GmailClient;private readonly repos:Repos;private readonly processor:Pick<MessageProcessor,'processMessage'>;private readonly now:()=>number;
  constructor(options:{gmail:GmailClient;repos:Repos;processor:Pick<MessageProcessor,'processMessage'>;now?:()=>number}){this.gmail=options.gmail;this.repos=options.repos;this.processor=options.processor;this.now=options.now??Date.now;}
  async estimateBacklog(range:BacklogRange):Promise<BacklogEstimate>{const page=await this.gmail.listMessages({q:buildBacklogQuery(range,this.now()),labelIds:['INBOX'],maxResults:1});const eligibleMessages=page.resultSizeEstimate??page.messages.length;const usage=(await this.repos.usage.listSince(0)).filter((e:any)=>e.kind==='classification');const tokenSamples=usage.map((e:any)=>e.inputTokens).filter((n:any)=>typeof n==='number'&&Number.isFinite(n));const costSamples=usage.map((e:any)=>e.costCents).filter((n:any)=>typeof n==='number'&&Number.isFinite(n));const avgTokens=tokenSamples.length?Math.round(tokenSamples.reduce((a:number,b:number)=>a+b,0)/tokenSamples.length):null;const costsReliable=usage.length>0&&costSamples.length===usage.length;const avgCost=costsReliable?costSamples.reduce((a:number,b:number)=>a+b,0)/costSamples.length:null;const estimatedInputTokens=avgTokens==null?null:avgTokens*eligibleMessages;const pricingUsd=estimatedInputTokens==null?null:(estimatedInputTokens/1_000_000)*ESTIMATED_INPUT_USD_PER_MTOK;const estimatedCostUsd=avgCost==null?pricingUsd:(avgCost*eligibleMessages)/100;return {eligibleMessages,estimatedCalls:eligibleMessages,estimatedInputTokens,estimatedCostCents:estimatedCostUsd==null?null:estimatedCostUsd*100,estimatedCostUsd,costEstimateUnavailable:estimatedCostUsd==null,costEstimateBasis:avgCost==null?(pricingUsd==null?'unavailable':'pricing_estimate'):'provider'};}
  async createBacklogJob(range:BacklogRange){const estimate=await this.estimateBacklog(range);const at=this.now();return this.repos.backlog.create({rangeJson:JSON.stringify(range),status:'pending',total:estimate.eligibleMessages,processed:0,failed:0,createdAt:at,updatedAt:at});}
  async runBacklogBatch(jobId:number){
    const job=this.requireJob(jobId);if(['paused','cancelled','completed'].includes(job.status))return job;
    const installation=this.repos.installation.get();const batchSize=Math.max(1,installation?.backlogBatchSize??25);this.repos.backlog.update(jobId,{status:'running',updatedAt:this.now()});
    const range=JSON.parse(job.rangeJson) as BacklogRange;const failedIds=new Set(this.repos.backlog.listFailureIds(jobId));const candidates:{id:string;threadId:string}[]=[];let pageToken:string|undefined;let exhausted=false;let moreEligibleSeen=false;
    do{const page=await this.gmail.listMessages({q:buildBacklogQuery(range,this.now()),labelIds:['INBOX'],maxResults:100,pageToken});for(const message of page.messages){if(failedIds.has(message.id))continue;if(candidates.length<batchSize)candidates.push(message);else moreEligibleSeen=true;}pageToken=page.nextPageToken;if(!pageToken)exhausted=true;}while(candidates.length<batchSize&&pageToken);
    let processed=job.processed,failed=job.failed,blocked=false;
    for(const message of candidates){const outcome=await this.processor.processMessage(message.id);if(outcome==='deferred'||outcome==='failed_transient'){blocked=true;break;}if(outcome==='processed'||outcome==='already_processed')processed++;else{this.repos.backlog.addFailure(jobId,message.id,'permanent',this.now());failedIds.add(message.id);failed++;}}
    const completed=!blocked&&exhausted&&!moreEligibleSeen;
    this.repos.backlog.update(jobId,{status:completed?'completed':'running',processed,failed,updatedAt:this.now()});return this.requireJob(jobId);
  }
  pauseBacklog(jobId:number){const job=this.requireJob(jobId);if(job.status==='completed'||job.status==='cancelled')return job;this.repos.backlog.update(jobId,{status:'paused',updatedAt:this.now()});return this.requireJob(jobId);}
  resumeBacklog(jobId:number){const job=this.requireJob(jobId);if(job.status!=='paused')return job;this.repos.backlog.update(jobId,{status:'pending',updatedAt:this.now()});return this.requireJob(jobId);}
  cancelBacklog(jobId:number){const job=this.requireJob(jobId);if(job.status==='completed')return job;this.repos.backlog.update(jobId,{status:'cancelled',updatedAt:this.now()});return this.requireJob(jobId);}
  private requireJob(id:number){const job=this.repos.backlog.get(id);if(!job)throw new Error('backlog job not found');return job;}
}
