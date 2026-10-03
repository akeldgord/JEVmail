import test from 'node:test'; import assert from 'node:assert/strict';
import { ensureClassificationLabels, ensureProcessedLabel, replaceClassificationLabel } from '../../../src/gmail/labels.ts';
import { DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';
class Fake { labels:any[]=[]; mods:any[]=[]; async listLabels(){return this.labels;} async createLabel(x:any){const v={id:`L${this.labels.length+1}`,...x};this.labels.push(v);return v;} async modifyMessage(id:string,add:string[],remove:string[]=[]){this.mods.push({id,add,remove});} }
test('setup creates classification labels idempotently and hidden marker',async()=>{const f:any=new Fake(); const a=await ensureClassificationLabels(f,DEFAULT_TAXONOMY); const b=await ensureClassificationLabels(f,DEFAULT_TAXONOMY); assert.equal(Object.keys(a).length,DEFAULT_TAXONOMY.labels.length); assert.deepEqual(a,b); const p=await ensureProcessedLabel(f); assert.equal(p.name,'JEVmail/Processed'); assert.equal(p.labelListVisibility,'labelHide'); assert.equal(p.messageListVisibility,'hide'); const p2=await ensureProcessedLabel(f); assert.equal(p.id,p2.id);});
test('correction only swaps app classification labels',async()=>{const f:any=new Fake(); await replaceClassificationLabel(f,'m1','old','new'); assert.deepEqual(f.mods[0],{id:'m1',add:['new'],remove:['old']});});

test('setup never reuses a Gmail system label as a classification label',async()=>{
  const f:any=new Fake();f.labels.push({id:'INBOX',name:'JEVmail/Reply Needed',type:'system'});
  const mapping=await ensureClassificationLabels(f,DEFAULT_TAXONOMY);
  assert.notEqual(mapping.reply_needed,'INBOX');
  assert.match(mapping.reply_needed,/^L/);
});
