import type { GmailClient } from '../gmail/types.ts';
import type { ClassificationTaxonomy } from '../domain/taxonomy.ts';
import { validateTaxonomy } from '../domain/taxonomy.ts';

function mappedLabelIds(configs:any[]):Set<string>{const ids=new Set<string>();for(const config of configs){try{const taxonomy=JSON.parse(config.taxonomyJson) as ClassificationTaxonomy;for(const label of taxonomy.labels)if(label.gmailLabelId)ids.add(label.gmailLabelId);}catch{}}return ids;}
export class CorrectionService{
  private readonly gmail:GmailClient;private readonly repos:any;private readonly now:()=>number;
  constructor(options:{gmail:GmailClient;repos:any;now?:()=>number}){this.gmail=options.gmail;this.repos=options.repos;this.now=options.now??Date.now;}
  async correctClassification(messageId:string,targetLabelId:string){
    const config=this.repos.config.getActive();if(!config)throw new Error('active classifier config missing');const taxonomy=JSON.parse(config.taxonomyJson) as ClassificationTaxonomy;const v=validateTaxonomy(taxonomy);if(!v.ok)throw new Error('invalid taxonomy');
    const target=taxonomy.labels.find(l=>l.id===targetLabelId&&l.enabled);if(!target?.gmailLabelId)throw new Error('unknown or disabled target label');const audit=this.repos.audit.get(messageId);if(!audit)throw new Error('classification audit not found');
    const message=await this.gmail.getMessage(messageId);const configs=this.repos.config.listAll?.()??[config];const appIds=mappedLabelIds(configs);const remove=message.labelIds.filter(id=>appIds.has(id)&&id!==target.gmailLabelId);
    await this.gmail.modifyMessage(messageId,[target.gmailLabelId],remove);if(audit.labelId!==targetLabelId)this.repos.audit.addCorrection({messageId,fromLabelId:audit.labelId,toLabelId:targetLabelId,correctedAt:this.now()});return{messageId,labelId:targetLabelId};
  }
}
