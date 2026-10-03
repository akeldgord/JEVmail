import test from 'node:test';
import assert from 'node:assert/strict';
import { addLabelWithApp,deleteLabelWithApp,saveLabelWithApp } from '../../../src/app/dashboard/labels/actions.ts';
import { saveClassifierWithApp } from '../../../src/app/dashboard/classifier/actions.ts';
import { DEFAULT_GLOBAL_INSTRUCTIONS,DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';

function configuredTaxonomy(){
  const t=structuredClone(DEFAULT_TAXONOMY);
  for(const label of t.labels){label.gmailLabelId=`G_${label.id}`;}
  return t;
}

function makeApp(taxonomy=configuredTaxonomy()){
  let active:any={hash:'old',provider:'jev',model:'jev-1.13.0',globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS,taxonomyJson:JSON.stringify(taxonomy),active:true};
  const saves:any[]=[];const events:string[]=[];
  const labels=taxonomy.labels.map((label:any)=>({id:label.gmailLabelId,name:label.gmailLabelName,type:'user'}));
  const app:any={
    repos:{config:{
      getActive(){return active;},
      save(x:any){events.push('save');saves.push(x);active={...x};}
    }},
    gmail:{
      async listLabels(){events.push('list');return labels;},
      async createLabel(input:any){events.push('create');const v={id:`G_new_${labels.length}`,type:'user',...input};labels.push(v);return v;}
    }
  };
  return{app,saves,events,get active(){return active;}};
}
function fd(values:Record<string,string>){const f=new FormData();for(const [k,v] of Object.entries(values))f.set(k,v);return f;}

test('label edit rejects over-budget guidance and leaves active config unchanged',async()=>{
  const h=makeApp();const before=h.active;
  await assert.rejects(()=>saveLabelWithApp(h.app,fd({
    labelId:'radiology_medicine',displayName:'Radiology / Medicine',guidance:'x'.repeat(500),
    enabled:'on',gmailLabelId:'G_radiology_medicine'
  })),/per-label budget/i);
  assert.equal(h.saves.length,0);assert.equal(h.active,before);
});

test('classifier settings reject over-budget instructions and leave active config unchanged',async()=>{
  const h=makeApp();const before=h.active;
  await assert.rejects(()=>saveClassifierWithApp(h.app,fd({
    model:'jev-1.13.0',globalInstructions:'x'.repeat(5000)
  })),/instruction/i);
  assert.equal(h.saves.length,0);assert.equal(h.active,before);
});

test('add category validates id mapping role and budget before activation',async()=>{
  const h1=makeApp();
  await assert.rejects(()=>addLabelWithApp(h1.app,fd({id:'Bad Id',displayName:'Bad',description:'x',guidance:'x'})),/lowercase letters/i);
  await assert.rejects(()=>addLabelWithApp(h1.app,fd({id:'reply_needed',displayName:'Duplicate',description:'x',guidance:'x'})),/already exists/i);

  const h2=makeApp();
  h2.app.gmail.listLabels=async()=>[{id:'INBOX',name:'Inbox',type:'system'}];
  await assert.rejects(()=>addLabelWithApp(h2.app,fd({id:'custom_system',displayName:'System',description:'x',guidance:'x',gmailLabelId:'INBOX'})),/system labels/i);

  const h3=makeApp();
  await assert.rejects(()=>addLabelWithApp(h3.app,fd({id:'too_long',displayName:'Too Long',description:'x',guidance:'y'.repeat(500)})),/per-label budget/i);
  assert.equal(h3.saves.length,0);

  const h4=makeApp();
  const before=JSON.parse(h4.active.taxonomyJson);
  const form=fd({id:'client_mail',displayName:'Client Mail',description:'Client correspondence',guidance:'Use for established client correspondence.',semanticRole:'reply_needed'});
  await addLabelWithApp(h4.app,form);
  assert.ok(h4.events.indexOf('create')>=0);
  assert.ok(h4.events.indexOf('create')<h4.events.indexOf('save'));
  const after=JSON.parse(h4.saves[0].taxonomyJson);
  const added=after.labels.find((x:any)=>x.id==='client_mail');
  assert.equal(added.semanticRole,'standard');
  assert.match(added.gmailLabelName,/JEVmail\/Client Mail/);
  for(const old of before.labels){
    const next=after.labels.find((x:any)=>x.id===old.id);
    assert.deepEqual(next,old);
  }
});

test('custom categories require disable before delete and default categories cannot be deleted',async()=>{
  const t=configuredTaxonomy();
  t.labels.push({id:'custom_delete',displayName:'Custom Delete',description:'x',guidance:'x',enabled:true,priority:500,semanticRole:'standard',gmailLabelName:'JEVmail/Custom Delete',gmailLabelId:'G_custom_delete'});
  const h=makeApp(t);
  await assert.rejects(()=>deleteLabelWithApp(h.app,fd({labelId:'custom_delete'})),/disable/i);
  await assert.rejects(()=>deleteLabelWithApp(h.app,fd({labelId:'radiology_medicine'})),/cannot be deleted/i);
  const active=JSON.parse(h.active.taxonomyJson);active.labels.find((x:any)=>x.id==='custom_delete').enabled=false;
  h.app.repos.config.getActive=()=>({...h.active,taxonomyJson:JSON.stringify(active)});
  await deleteLabelWithApp(h.app,fd({labelId:'custom_delete'}));
  const saved=JSON.parse(h.saves.at(-1).taxonomyJson);
  assert.equal(saved.labels.some((x:any)=>x.id==='custom_delete'),false);
});
