import type { Classifier,ClassificationResult } from '../classifier/types.ts';
import type { ClassificationTaxonomy } from '../domain/taxonomy.ts';
import { validateTaxonomy } from '../domain/taxonomy.ts';
import type { GmailClient } from '../gmail/types.ts';
import { fetchMessageContext,serializeContextForClassifier } from '../gmail/context-builder.ts';

export class ClassifierTestService{
  private readonly classifier:Classifier;private readonly repos:any;private readonly gmail?:GmailClient;
  constructor(options:{classifier:Classifier;repos:any;gmail?:GmailClient}){this.classifier=options.classifier;this.repos=options.repos;this.gmail=options.gmail;}
  async testClassifier(sample:{text?:string;messageId?:string}):Promise<ClassificationResult>{
    const config=this.repos.config.getActive();if(!config)throw new Error('active classifier config missing');
    const taxonomy=JSON.parse(config.taxonomyJson) as ClassificationTaxonomy;const v=validateTaxonomy(taxonomy);if(!v.ok)throw new Error('invalid taxonomy');
    let serializedState:string;let gmailMessageId='test-console';
    if(sample.messageId){if(!this.gmail)throw new Error('Gmail is not available');gmailMessageId=sample.messageId;serializedState=serializeContextForClassifier(await fetchMessageContext(this.gmail,sample.messageId),7600);}
    else{const text=(sample.text??'').trim();if(!text)throw new Error('sample text is required');serializedState=JSON.stringify({current:{subject:'Classifier test',body:text,attachments:[]},prior:[]}).slice(0,7600);}
    return this.classifier.classify({gmailMessageId,serializedState,taxonomy,globalInstructions:config.globalInstructions,provider:config.provider,model:config.model,configHash:config.hash,testRun:true});
  }
}
