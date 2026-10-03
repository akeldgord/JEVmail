import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDefaultTaxonomy } from '../../../src/services/setup-service.ts';
import { DEFAULT_GLOBAL_INSTRUCTIONS,DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';

const FUTURE_DEFAULT={
  id:'future_default',displayName:'Future Default',description:'A future upstream default category.',
  guidance:'Use for the future default fixture.',enabled:true,priority:85,semanticRole:'standard' as const,
  gmailLabelName:'JEVmail/Future Default'
};

function oldTaxonomy(){
  const t=structuredClone(DEFAULT_TAXONOMY);
  for(const label of t.labels)label.gmailLabelId=`G_${label.id}`;
  t.labels.find(label=>label.id==='newsletter_subscription')!.guidance='USER CUSTOM GUIDANCE';
  return t;
}

function defaultsWithFuture(){
  const t=structuredClone(DEFAULT_TAXONOMY);
  t.labels.splice(t.labels.length-1,0,structuredClone(FUTURE_DEFAULT));
  return t;
}

function harness(taxonomy:any){
  let active:any={hash:'oldhash',provider:'jev',model:'jev-1.13.0',globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS,taxonomyJson:JSON.stringify(taxonomy),createdAt:1,active:true};
  const saves:any[]=[];const created:any[]=[];let listCalls=0;const warnings:any[]=[];
  const gmailLabels=taxonomy.labels.map((label:any)=>({id:label.gmailLabelId,name:label.gmailLabelName,type:'user'}));
  const repos:any={
    config:{getActive(){return active;},save(x:any){saves.push(x);active={...x};}},
    error:{add(x:any){warnings.push(x);},hasConfigWarning(hash:string,category:string){return warnings.some(w=>w.configHash===hash&&w.category===category);}}
  };
  const gmail:any={
    async listLabels(){listCalls++;return gmailLabels;},
    async createLabel(input:any){const value={id:`G_CREATED_${created.length+1}`,type:'user',...input};created.push(value);gmailLabels.push(value);return value;}
  };
  return{repos,gmail,saves,created,warnings,get active(){return active;},get listCalls(){return listCalls;}};
}

test('existing install merges a newly shipped default while preserving user edits exactly',async()=>{
  const t=oldTaxonomy();
  const beforeNewsletter=structuredClone(t.labels.find((x:any)=>x.id==='newsletter_subscription'));
  const h=harness(t);
  const result=await mergeDefaultTaxonomy({gmail:h.gmail,repos:h.repos,now:100,defaults:defaultsWithFuture()});
  assert.deepEqual(result.added,['future_default']);
  assert.deepEqual(result.pending,[]);
  assert.equal(h.created.length,1);
  assert.equal(h.created[0].name,'JEVmail/Future Default');
  assert.equal(h.saves.length,1);
  const merged=JSON.parse(h.active.taxonomyJson);
  assert.equal(merged.labels.length,DEFAULT_TAXONOMY.labels.length+1);
  assert.deepEqual(merged.labels.find((x:any)=>x.id==='newsletter_subscription'),beforeNewsletter);
  assert.ok(merged.labels.find((x:any)=>x.id==='future_default')?.gmailLabelId);
});

test('second default merge is idempotent with zero Gmail and config writes',async()=>{
  const h=harness(oldTaxonomy());
  const defaults=defaultsWithFuture();
  await mergeDefaultTaxonomy({gmail:h.gmail,repos:h.repos,now:100,defaults});
  const firstLists=h.listCalls;const firstCreates=h.created.length;const firstSaves=h.saves.length;
  const second=await mergeDefaultTaxonomy({gmail:h.gmail,repos:h.repos,now:101,defaults});
  assert.deepEqual(second.added,[]);
  assert.deepEqual(second.pending,[]);
  assert.equal(h.listCalls,firstLists);
  assert.equal(h.created.length,firstCreates);
  assert.equal(h.saves.length,firstSaves);
});

test('budget-full default merge leaves pending category visible and performs no Gmail write',async()=>{
  const t=oldTaxonomy();
  let n=0;
  while(t.labels.length<20){
    t.labels.splice(t.labels.length-1,0,{
      id:`custom_${n}`,displayName:`Custom ${n}`,description:'x',guidance:'Use for custom workflow.',
      enabled:true,priority:300+n,semanticRole:'standard',gmailLabelName:`JEVmail/Custom ${n}`,gmailLabelId:`G_custom_${n}`
    });n++;
  }
  const h=harness(t);
  const result=await mergeDefaultTaxonomy({gmail:h.gmail,repos:h.repos,now:200,defaults:defaultsWithFuture()});
  assert.deepEqual(result.added,[]);
  assert.deepEqual(result.pending,['future_default']);
  assert.equal(h.created.length,0);
  assert.equal(h.listCalls,0);
  assert.equal(h.saves.length,0);
  assert.equal(h.warnings.length,1);
  assert.equal(h.warnings[0].category,'default_taxonomy_pending');
  assert.match(h.warnings[0].detail,/pending/i);
});
