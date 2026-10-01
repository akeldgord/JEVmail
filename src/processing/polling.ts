import type { GmailClient } from '../gmail/types.ts';
import type { MessageProcessor, ProcessOutcome } from './processor.ts';
import { requiresGmailReconnect } from './retry-policy.ts';

export type PollStatus = 'ok' | 'paused' | 'needs_reconnect' | 'deferred' | 'not_ready';
export type PollResult = { status: PollStatus; examined: number; processed: number; failures: number };
type InstallationRepository = {get(): any;patch?(value: any): void;};

export function buildIncomingQuery(watermarkMs: number): string {const seconds = Math.floor(watermarkMs / 1000);return `after:${seconds} -label:"JEVmail/Processed"`;}

export class PollingService {
  private readonly gmail: GmailClient;private readonly repos: { installation: InstallationRepository; error?:{add(value:any):void} };private readonly processor: Pick<MessageProcessor, 'processMessage'>;private readonly now: () => number;
  constructor(options: { gmail:GmailClient; repos:{installation:InstallationRepository;error?:{add(value:any):void}}; processor:Pick<MessageProcessor,'processMessage'>; now?:()=>number }) {this.gmail=options.gmail; this.repos=options.repos; this.processor=options.processor; this.now=options.now??Date.now;}
  async initializeWatermark(): Promise<number> {const installation=this.repos.installation.get();if(!installation) throw new Error('installation missing');if(installation.startupWatermarkMs > 0) return installation.startupWatermarkMs;if(!this.repos.installation.patch) throw new Error('installation repository cannot initialize watermark');const watermark=this.now();this.repos.installation.patch({startupWatermarkMs:watermark});return watermark;}
  async pollOnce(): Promise<PollResult> {
    const finish=(result:PollResult)=>{this.repos.installation.patch?.({lastPollAt:this.now(),lastPollStatus:result.status});return result;};
    const installation=this.repos.installation.get();
    if(!installation?.startupWatermarkMs || !installation?.processedLabelId) return finish({status:'not_ready',examined:0,processed:0,failures:0});
    if(installation.paused) return finish({status:'paused',examined:0,processed:0,failures:0});
    if(installation.needsReconnect) return finish({status:'needs_reconnect',examined:0,processed:0,failures:0});
    let pageToken: string|undefined;let examined=0, processed=0, failures=0;
    do {
      let page;
      try{page=await this.gmail.listMessages({q:buildIncomingQuery(installation.startupWatermarkMs),labelIds:['INBOX'],pageToken,maxResults:100});}
      catch(error){if(requiresGmailReconnect(error)){this.repos.installation.patch?.({needsReconnect:true});this.repos.error?.add({stage:'poll',category:'gmail_auth',messageId:null,createdAt:this.now()});return finish({status:'needs_reconnect',examined,processed,failures});}throw error;}
      for(const message of page.messages){
        examined++;const outcome:ProcessOutcome=await this.processor.processMessage(message.id);
        if(this.repos.installation.get()?.needsReconnect)return finish({status:'needs_reconnect',examined,processed,failures:failures+1});
        if(outcome==='deferred') return finish({status:'deferred',examined,processed,failures});
        if(outcome==='processed'||outcome==='already_processed') processed++; else failures++;
      }
      pageToken=page.nextPageToken;
    } while(pageToken);
    return finish({status:'ok',examined,processed,failures});
  }
}
