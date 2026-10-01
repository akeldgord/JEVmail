import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../../../src/db/client.ts';
import { createRepositories } from '../../../src/db/repositories/index.ts';
import { ensureInstallationSetup } from '../../../src/services/setup-service.ts';
import { JevClient } from '../../../src/classifier/jev-client.ts';
import { JevClassifier } from '../../../src/classifier/jev-classifier.ts';
import { RateGovernor } from '../../../src/processing/limiter.ts';
import { MessageProcessor } from '../../../src/processing/processor.ts';
import { PollingService } from '../../../src/processing/polling.ts';
import { CorrectionService } from '../../../src/services/correction-service.ts';
import { BacklogManager } from '../../../src/processing/backlog.ts';
import type { GmailMessage,GmailThread,GmailLabel } from '../../../src/gmail/types.ts';

const body=(text:string)=>({mimeType:'text/plain',filename:'',headers:[],body:{data:Buffer.from(text).toString('base64url'),size:text.length}});
const msg=(id:string,threadId:string,internalDate:number,text:string,subject:string):GmailMessage=>({id,threadId,internalDate,labelIds:['INBOX'],payload:{...body(text),headers:[{name:'From',value:'sender@example.com'},{name:'To',value:'me@example.com'},{name:'Subject',value:subject}]}});

class FakeGmail {
  labels:GmailLabel[]=[]; messages=new Map<string,GmailMessage>(); threads=new Map<string,GmailThread>(); nextLabel=1;
  async listLabels(){return this.labels.map(x=>({...x}));}
  async createLabel(input:any){const label={id:`L${this.nextLabel++}`,...input};this.labels.push(label);return label;}
  async modifyMessage(id:string,add:string[],remove:string[]=[]){const m=this.messages.get(id)!;m.labelIds=m.labelIds.filter(x=>!remove.includes(x));for(const x of add)if(!m.labelIds.includes(x))m.labelIds.push(x);}
  async getMessage(id:string){return structuredClone(this.messages.get(id)!);}
  async getThread(id:string){return structuredClone(this.threads.get(id)!);}
  async listMessages(q:any){const afterMatch=String(q.q??'').match(/after:(\d+)/);const beforeMatch=String(q.q??'').match(/before:(\d+)/);const excludeProcessed=String(q.q??'').includes('JEVmail/Processed');const processedId=this.labels.find(l=>l.name==='JEVmail/Processed')?.id;let all=[...this.messages.values()].filter(m=>m.labelIds.includes('INBOX'));if(afterMatch)all=all.filter(m=>m.internalDate/1000>Number(afterMatch[1]));if(beforeMatch)all=all.filter(m=>m.internalDate/1000<Number(beforeMatch[1]));if(excludeProcessed&&processedId)all=all.filter(m=>!m.labelIds.includes(processedId));const max=q.maxResults??100;return{messages:all.slice(0,max).map(m=>({id:m.id,threadId:m.threadId})),resultSizeEstimate:all.length};}
}

test('complete fake mail flow is once-only, handling-first, auditable, correctable, and privacy-first',async()=>{
  const db=createDatabase(':memory:');const repos:any=createRepositories(db);const gmail:any=new FakeGmail();
  const old=msg('old','to',500,'OLD SECRET BODY','Old mail');gmail.messages.set(old.id,old);gmail.threads.set('to',{id:'to',messages:[old]});
  const priors=[msg('p0','tn',600,'PRIOR ZERO','Thread'),msg('p1','tn',700,'PRIOR ONE','Thread'),msg('p2','tn',800,'PRIOR TWO','Thread'),msg('p3','tn',900,'PRIOR THREE','Thread')];
  const current=msg('new','tn',2000,'SECRET-BODY-DO-NOT-PERSIST Can you send the final version?','Need final version');
  for(const m of [...priors,current])gmail.messages.set(m.id,m);gmail.threads.set('tn',{id:'tn',messages:[...priors,current]});

  await ensureInstallationSetup({email:'me@example.com',gmail,repos,model:'jev-1.13.0',now:1000});
  const processedId=repos.installation.get().processedLabelId;const active=repos.config.getActive();const taxonomy=JSON.parse(active.taxonomyJson);const replyGmailId=taxonomy.labels.find((l:any)=>l.id==='reply_needed').gmailLabelId;
  let providerCalls=0;let seenState='';
  const transport:any=async(_url:any,init:any)=>{providerCalls++;const request=JSON.parse(init.body);seenState=request.state;return new Response(JSON.stringify({model:'jev-1.13.0',answers:{handling:{type:'choice',choice:'reply_needed',probabilities:{reply_needed:.93,indeterminate:.07},confidence:.93}},usage:{input_tokens:321,output_tokens:3}}),{status:200,headers:{'content-type':'application/json'}});};
  const classifier=new JevClassifier(new JevClient({baseUrl:'https://jevmodel.org',apiKey:'fake',transport}));
  const governor=new RateGovernor(repos.usage,()=>({maxPerMinute:30,maxPerHour:300,maxPerDay:2000}));
  const processor=new MessageProcessor({gmail,classifier,repos,governor,now:()=>3000});
  const poller=new PollingService({gmail,repos,processor,now:()=>3000});

  const first=await poller.pollOnce();assert.equal(first.status,'ok');assert.equal(providerCalls,1);
  assert.equal(gmail.messages.get('old').labelIds.length,1);
  assert.equal(gmail.messages.get('new').labelIds.includes(replyGmailId),true);assert.equal(gmail.messages.get('new').labelIds.includes(processedId),true);
  assert.match(seenState,/SECRET-BODY-DO-NOT-PERSIST/);assert.match(seenState,/PRIOR ONE/);assert.match(seenState,/PRIOR TWO/);assert.match(seenState,/PRIOR THREE/);assert.doesNotMatch(seenState,/PRIOR ZERO/);
  assert.equal(repos.audit.get('new').labelId,'reply_needed');

  await poller.pollOnce();assert.equal(providerCalls,1);

  const correction=new CorrectionService({gmail,repos,now:()=>4000});await correction.correctClassification('new','receipt_record');
  const receiptId=taxonomy.labels.find((l:any)=>l.id==='receipt_record').gmailLabelId;assert.equal(gmail.messages.get('new').labelIds.includes(processedId),true);assert.equal(gmail.messages.get('new').labelIds.includes(receiptId),true);assert.equal(gmail.messages.get('new').labelIds.includes(replyGmailId),false);

  const backlog=new BacklogManager({gmail,repos,processor,now:()=>5000});const estimate=await backlog.estimateBacklog({kind:'all'});assert.equal(estimate.eligibleMessages,5); // old + four prior thread messages; processed current is excluded
  const tableNames=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map(r=>r.name);let persisted='';for(const table of tableNames){persisted+=JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());}
  assert.doesNotMatch(persisted,/SECRET-BODY-DO-NOT-PERSIST|PRIOR ONE|PRIOR TWO|PRIOR THREE|OLD SECRET BODY|Need final version|sender@example\.com/);
  db.close();
});
