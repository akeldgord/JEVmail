import test from 'node:test'; import assert from 'node:assert/strict';
import { DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';
import { hashClassifierConfig, validatePinnedModel } from '../../../src/domain/config-version.ts';
const base = { provider:'jev', model:'jev-1.13.0', globalInstructions:'handle by action', taxonomy: DEFAULT_TAXONOMY };
test('config hash is stable across key order and changes with behavior', () => {
  assert.equal(hashClassifierConfig(base), hashClassifierConfig({taxonomy:DEFAULT_TAXONOMY,globalInstructions:'handle by action',model:'jev-1.13.0',provider:'jev'}));
  assert.notEqual(hashClassifierConfig(base), hashClassifierConfig({...base,globalInstructions:'changed'}));
  assert.notEqual(hashClassifierConfig(base), hashClassifierConfig({...base,model:'jev-1.14.0'}));
});
test('production model must be pinned', () => {
  assert.equal(validatePinnedModel('jev-1.13.0'), true);
  assert.equal(validatePinnedModel('jev-latest'), false);
  assert.equal(validatePinnedModel('jev-preview'), false);
});
