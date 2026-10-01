import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassifierTestService } from '../../../src/services/classifier-test-service.ts';
import { DEFAULT_TAXONOMY,DEFAULT_GLOBAL_INSTRUCTIONS } from '../../../src/domain/defaults.ts';

test('test console returns model output without production attempts, audits, processed markers, or Gmail writes',async()=>{
  const taxonomy=structuredClone(DEFAULT_TAXONOMY);let calls=0;let seen:any;
  const classifier:any={async classify(req:any){calls++;seen=req;return{labelId:'cold_marketing',probabilities:{cold_marketing:.8,indeterminate:.2},confidence:.8,provider:'jev',model:req.model,usage:{input_tokens:22},configHash:req.configHash,idempotencyKey:'test-x'};}};
  const repos:any={config:{getActive(){return{hash:'cfg',provider:'jev',model:'jev-1.13.0',globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS,taxonomyJson:JSON.stringify(taxonomy)};}}};
  const service=new ClassifierTestService({classifier,repos});
  const result=await service.testClassifier({text:'Hi, can I get 15 minutes to demo our product?'});
  assert.equal(calls,1);assert.equal(seen.testRun,true);assert.equal(seen.configHash,'cfg');assert.equal(result.labelId,'cold_marketing');assert.equal(result.usage.input_tokens,22);
  assert.match(seen.serializedState,/demo our product/);
});
