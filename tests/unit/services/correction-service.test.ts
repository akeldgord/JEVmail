import test from 'node:test';
import assert from 'node:assert/strict';
import { CorrectionService } from '../../../src/services/correction-service.ts';
import { DEFAULT_TAXONOMY,DEFAULT_GLOBAL_INSTRUCTIONS } from '../../../src/domain/defaults.ts';
import { assertOperationalAccount } from '../../../src/auth/google-account.ts';

function configured(){const t=structuredClone(DEFAULT_TAXONOMY);for(const l of t.labels)l.gmailLabelId=`g-${l.id}`;return t;}

test('manual correction replaces only app classification label, preserves processed/non-app labels, and audits without classifier',async()=>{
  const taxonomy=configured();const labels=new Set(['INBOX','STARRED','processed','g-newsletter_subscription']);const modifications:any[]=[];const corrections:any[]=[];
  const gmail:any={async getMessage(){return{id:'m1',threadId:'t',labelIds:[...labels],internalDate:1};},async modifyMessage(_id:string,add:string[],remove:string[]=[]){modifications.push({add,remove});for(const x of remove)labels.delete(x);for(const x of add)labels.add(x);}};
  const repos:any={installation:{get(){return{processedLabelId:'processed'};}},config:{getActive(){return{hash:'h',provider:'jev',model:'jev-1.13.0',globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS,taxonomyJson:JSON.stringify(taxonomy)};}},audit:{get(){return{messageId:'m1',labelId:'newsletter_subscription'};},addCorrection(x:any){corrections.push(x);}}};
  const service=new CorrectionService({gmail,repos,now:()=>123});
  await service.correctClassification('m1','reply_needed');
  assert.equal(labels.has('processed'),true);assert.equal(labels.has('INBOX'),true);assert.equal(labels.has('STARRED'),true);
  assert.equal(labels.has('g-reply_needed'),true);assert.equal(labels.has('g-newsletter_subscription'),false);
  assert.equal([...labels].filter(x=>x.startsWith('g-')).length,1);
  assert.deepEqual(corrections,[{messageId:'m1',fromLabelId:'newsletter_subscription',toLabelId:'reply_needed',correctedAt:123}]);
  assert.equal(modifications.length,1);
});

test('rejects unknown or disabled correction targets',async()=>{
  const taxonomy=configured();taxonomy.labels.find(l=>l.id==='political')!.enabled=false;
  const gmail:any={async getMessage(){return{id:'m1',threadId:'t',labelIds:[],internalDate:1};},async modifyMessage(){throw new Error('not reached');}};
  const repos:any={installation:{get(){return{processedLabelId:'p'};}},config:{getActive(){return{taxonomyJson:JSON.stringify(taxonomy)};}},audit:{get(){return{labelId:'fyi_no_action'};},addCorrection(){}}};
  const service=new CorrectionService({gmail,repos});
  await assert.rejects(()=>service.correctClassification('m1','bogus'));
  await assert.rejects(()=>service.correctClassification('m1','political'));
});

test('bound account checks reject another identity and revoked grants require reconnect',()=>{
  assert.throws(()=>assertOperationalAccount({accountEmail:'me@example.com',encryptedRefreshToken:'x',needsReconnect:false},'other@example.com'));
  assert.throws(()=>assertOperationalAccount({accountEmail:'me@example.com',encryptedRefreshToken:'x',needsReconnect:true},'me@example.com'),/reconnect/i);
  assert.doesNotThrow(()=>assertOperationalAccount({accountEmail:'me@example.com',encryptedRefreshToken:'x',needsReconnect:false},'ME@example.com'));
});

test('correction removes historical app label mappings after taxonomy remap',async()=>{
  const oldTax=configured();oldTax.labels.find(l=>l.id==='newsletter_subscription')!.gmailLabelId='old-newsletter';
  const activeTax=configured();activeTax.labels.find(l=>l.id==='newsletter_subscription')!.gmailLabelId='new-newsletter';activeTax.labels.find(l=>l.id==='reply_needed')!.gmailLabelId='new-reply';
  const labels=new Set(['INBOX','processed','old-newsletter']);
  const gmail:any={async getMessage(){return{id:'m1',threadId:'t',labelIds:[...labels],internalDate:1};},async modifyMessage(_id:string,add:string[],remove:string[]=[]){for(const x of remove)labels.delete(x);for(const x of add)labels.add(x);}};
  const configs=[{hash:'old',taxonomyJson:JSON.stringify(oldTax)},{hash:'new',taxonomyJson:JSON.stringify(activeTax)}];
  const repos:any={config:{getActive(){return{...configs[1],provider:'jev',model:'jev-1.13.0',globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS};},listAll(){return configs;}},audit:{get(){return{messageId:'m1',labelId:'newsletter_subscription',configHash:'old'};},addCorrection(){}},installation:{get(){return{processedLabelId:'processed'};}}};
  await new CorrectionService({gmail,repos}).correctClassification('m1','reply_needed');
  assert.equal(labels.has('old-newsletter'),false);
  assert.equal(labels.has('new-reply'),true);
  assert.equal([...labels].filter(x=>x.includes('newsletter')||x.includes('reply')).length,1);
});
