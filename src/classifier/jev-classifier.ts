import { createHash,randomUUID } from 'node:crypto';
import type { Classifier,ClassificationRequest,ClassificationResult } from './types.ts';
import { buildJevQuestion } from './prompt-builder.ts';
import { JevClient } from './jev-client.ts';
function stableKey(messageId:string,configHash:string){return createHash('sha256').update(`${messageId}:${configHash}`).digest('hex');}
export class JevClassifier implements Classifier{
  private client:JevClient;
  constructor(client:JevClient){this.client=client;}
  async classify(request:ClassificationRequest):Promise<ClassificationResult>{
    const question=buildJevQuestion(request.taxonomy,request.globalInstructions);
    const key=request.testRun?`test-${randomUUID()}`:stableKey(request.gmailMessageId,request.configHash);
    const response=await this.client.evaluate({model:request.model,state:request.serializedState,questions:{handling:question}},key);
    const answer=response.answers?.handling;
    if(!answer||answer.type!=='choice'||!answer.choice) throw new Error('Jev response missing handling choice');
    const label=request.taxonomy.labels.find(l=>l.id===answer.choice&&l.enabled);
    if(!label) throw new Error(`Jev returned unknown or disabled label: ${answer.choice}`);
    return {labelId:label.id,probabilities:answer.probabilities??{},confidence:typeof answer.confidence==='number'?answer.confidence:null,provider:request.provider,model:response.model||request.model,usage:response.usage??{},configHash:request.configHash,idempotencyKey:key};
  }
}
