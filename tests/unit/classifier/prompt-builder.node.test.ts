import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevQuestion,CRITERIA_BUDGET_CHARS,CRITERION_MAX_CHARS,prepareJevQuestion,validatePromptBudget } from '../../../src/classifier/prompt-builder.ts';
import { DEFAULT_TAXONOMY,DEFAULT_GLOBAL_INSTRUCTIONS } from '../../../src/domain/defaults.ts';

test('builds one bounded choice question from enabled stable ids with precedence',()=>{
  const q=buildJevQuestion(DEFAULT_TAXONOMY,DEFAULT_GLOBAL_INSTRUCTIONS);
  assert.equal(q.type,'choice');
  assert.equal(Object.keys(q.criteria).length,DEFAULT_TAXONOMY.labels.filter(x=>x.enabled).length);
  assert.ok('reply_needed' in q.criteria);
  assert.ok('indeterminate' in q.criteria);
  assert.ok('radiology_medicine' in q.criteria);
  assert.match(q.instructions,/Reply Needed/i);
  assert.match(q.instructions,/Action Needed/i);
  assert.ok(JSON.stringify(q.criteria).length<=CRITERIA_BUDGET_CHARS);
});

test('disabled labels are absent but indeterminate remains',()=>{
  const t=structuredClone(DEFAULT_TAXONOMY);
  t.labels.find(x=>x.id==='political')!.enabled=false;
  const q=buildJevQuestion(t,DEFAULT_GLOBAL_INSTRUCTIONS);
  assert.equal('political' in q.criteria,false);
  assert.ok('indeterminate' in q.criteria);
});

test('guidance-first truncation preserves decisive guidance tail',()=>{
  const t=structuredClone(DEFAULT_TAXONOMY);
  const label=t.labels.find(x=>x.id==='radiology_medicine')!;
  label.guidance='x'.repeat(CRITERION_MAX_CHARS)+' DECISIVE_TAIL_PHRASE';
  label.description='STATIC DESCRIPTION SHOULD LOSE FIRST';
  const prepared=prepareJevQuestion(t,DEFAULT_GLOBAL_INSTRUCTIONS);
  assert.match(prepared.question.criteria.radiology_medicine,/DECISIVE_TAIL_PHRASE/);
  assert.doesNotMatch(prepared.question.criteria.radiology_medicine,/STATIC DESCRIPTION SHOULD LOSE FIRST/);
  assert.ok(prepared.warnings.some(w=>/truncated/.test(w)));
});

test('20 realistic labels fit and reach the choice question without truncation warnings',()=>{
  const t=structuredClone(DEFAULT_TAXONOMY);
  while(t.labels.length<20){
    const n=t.labels.length;
    t.labels.splice(t.labels.length-1,0,{
      id:`custom_${n}`,displayName:`Custom ${n}`,description:'Reference category.',
      guidance:'Use for a specific recurring workflow when reply and action categories do not apply.',
      enabled:true,priority:200+n,semanticRole:'standard',gmailLabelName:`JEVmail/Custom ${n}`
    });
  }
  const budget=validatePromptBudget(t,DEFAULT_GLOBAL_INSTRUCTIONS);
  assert.equal(budget.ok,true,budget.errors.join(' '));
  const prepared=prepareJevQuestion(t,DEFAULT_GLOBAL_INSTRUCTIONS);
  assert.equal(Object.keys(prepared.question.criteria).length,20);
  assert.deepEqual(prepared.warnings,[]);
});
