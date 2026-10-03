import test from 'node:test';
import assert from 'node:assert/strict';
import { JevClassifier } from '../../../src/classifier/jev-classifier.ts';
import { prepareJevQuestion } from '../../../src/classifier/prompt-builder.ts';
import { DEFAULT_GLOBAL_INSTRUCTIONS,DEFAULT_TAXONOMY } from '../../../src/domain/defaults.ts';

function twentyLabelTaxonomy(){
  const t=structuredClone(DEFAULT_TAXONOMY);
  while(t.labels.length<20){
    const n=t.labels.length;
    t.labels.splice(t.labels.length-1,0,{
      id:`custom_${n}`,displayName:`Custom ${n}`,description:'Reference category.',
      guidance:'Use for a specific recurring workflow when reply and action categories do not apply.',
      enabled:true,priority:200+n,semanticRole:'standard',gmailLabelName:`JEVmail/Custom ${n}`
    });
  }
  return t;
}

test('20-label choice criteria reach the Jev transport unchanged',async()=>{
  const taxonomy=twentyLabelTaxonomy();
  const expected=prepareJevQuestion(taxonomy,DEFAULT_GLOBAL_INSTRUCTIONS).question;
  let captured:any=null;
  const client:any={
    async evaluate(body:any,key:string){
      captured={body,key};
      return{
        model:'jev-1.13.0',
        answers:{handling:{type:'choice',choice:'reply_needed',confidence:.9,probabilities:{reply_needed:.9}}},
        usage:{input_tokens:100,output_tokens:1}
      };
    }
  };
  const classifier=new JevClassifier(client);
  const result=await classifier.classify({
    gmailMessageId:'m1',
    serializedState:'state',
    taxonomy,
    globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS,
    provider:'jev',
    model:'jev-1.13.0',
    configHash:'hash'
  });
  assert.equal(result.labelId,'reply_needed');
  assert.equal(Object.keys(captured.body.questions.handling.criteria).length,20);
  assert.deepEqual(captured.body.questions.handling.criteria,expected.criteria);
  assert.equal(captured.body.questions.handling.instructions,expected.instructions);
});
