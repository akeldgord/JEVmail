import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';
import { validateTaxonomy } from '../../../src/domain/taxonomy.ts';
import { validatePromptBudget } from '../../../src/classifier/prompt-builder.ts';
import { DEFAULT_GLOBAL_INSTRUCTIONS } from '../../../src/domain/defaults.ts';

test('default taxonomy contains required protected roles without pinning total count',()=>{
  const byId=new Map(DEFAULT_TAXONOMY.labels.map(label=>[label.id,label]));
  for(const id of ['reply_needed','action_needed','indeterminate'])assert.ok(byId.has(id),`missing ${id}`);
  assert.equal(byId.get('reply_needed')?.semanticRole,'reply_needed');
  assert.equal(byId.get('action_needed')?.semanticRole,'action_needed');
  assert.equal(byId.get('indeterminate')?.semanticRole,'indeterminate');
  assert.ok(DEFAULT_TAXONOMY.labels.length>=12);
  assert.equal(validateTaxonomy(DEFAULT_TAXONOMY).ok,true);
  assert.equal(validatePromptBudget(DEFAULT_TAXONOMY,DEFAULT_GLOBAL_INSTRUCTIONS).ok,true);
});

test('indeterminate cannot be disabled and duplicate ids are rejected',()=>{
  const disabled=structuredClone(DEFAULT_TAXONOMY);disabled.labels.find(x=>x.id==='indeterminate')!.enabled=false;
  assert.equal(validateTaxonomy(disabled).ok,false);
  const dup=structuredClone(DEFAULT_TAXONOMY);dup.labels[1].id=dup.labels[0].id;
  assert.equal(validateTaxonomy(dup).ok,false);
});

test('rejects Gmail system-label mappings and duplicate visible label mappings',()=>{
  const system=structuredClone(DEFAULT_TAXONOMY);system.labels[0].gmailLabelId='INBOX';
  const systemResult=validateTaxonomy(system);assert.equal(systemResult.ok,false);if(!systemResult.ok)assert.match(systemResult.errors.join(' '),/system label/i);
  const duplicate=structuredClone(DEFAULT_TAXONOMY);duplicate.labels[0].gmailLabelId='Label_1';duplicate.labels[1].gmailLabelId='Label_1';
  const duplicateResult=validateTaxonomy(duplicate);assert.equal(duplicateResult.ok,false);if(!duplicateResult.ok)assert.match(duplicateResult.errors.join(' '),/duplicate gmail label/i);
});
