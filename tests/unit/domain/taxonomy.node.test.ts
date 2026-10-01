import test from 'node:test'; import assert from 'node:assert/strict';
import { DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';
import { validateTaxonomy } from '../../../src/domain/taxonomy.ts';

test('default taxonomy has approved handling order and protected roles', () => {
  assert.equal(DEFAULT_TAXONOMY.labels.length, 12);
  assert.deepEqual(DEFAULT_TAXONOMY.labels.map(x=>x.id), [
    'reply_needed','action_needed','reservation_confirmation','receipt_record','account_security',
    'verification_code','shipping_delivery','fyi_no_action','newsletter_subscription','cold_marketing','political','indeterminate'
  ]);
  assert.equal(DEFAULT_TAXONOMY.labels[0].semanticRole, 'reply_needed');
  assert.equal(DEFAULT_TAXONOMY.labels[1].semanticRole, 'action_needed');
  assert.equal(DEFAULT_TAXONOMY.labels[11].semanticRole, 'indeterminate');
});

test('indeterminate cannot be disabled and duplicate ids are rejected', () => {
  const disabled = structuredClone(DEFAULT_TAXONOMY); disabled.labels.at(-1)!.enabled = false;
  assert.equal(validateTaxonomy(disabled).ok, false);
  const dup = structuredClone(DEFAULT_TAXONOMY); dup.labels[1].id = dup.labels[0].id;
  assert.equal(validateTaxonomy(dup).ok, false);
});

test('rejects Gmail system-label mappings and duplicate visible label mappings',()=>{
  const system=structuredClone(DEFAULT_TAXONOMY);system.labels[0].gmailLabelId='INBOX';
  const systemResult=validateTaxonomy(system);assert.equal(systemResult.ok,false);if(!systemResult.ok)assert.match(systemResult.errors.join(' '),/system label/i);
  const duplicate=structuredClone(DEFAULT_TAXONOMY);duplicate.labels[0].gmailLabelId='Label_1';duplicate.labels[1].gmailLabelId='Label_1';
  const duplicateResult=validateTaxonomy(duplicate);assert.equal(duplicateResult.ok,false);if(!duplicateResult.ok)assert.match(duplicateResult.errors.join(' '),/duplicate gmail label/i);
});
