import type { ClassificationTaxonomy } from '../domain/taxonomy.ts';
import { enabledLabels } from '../domain/taxonomy.ts';
export type JevChoiceQuestion={type:'choice';instructions:string;criteria:Record<string,string>};
export function buildJevQuestion(taxonomy:ClassificationTaxonomy,globalInstructions:string):JevChoiceQuestion{
  const labels=enabledLabels(taxonomy);
  if(labels.length<2||labels.length>20) throw new Error('Jev choice requires 2-20 enabled labels');
  const instructions=`${globalInstructions}\nReturn exactly one handling label. Reply Needed has highest precedence; Action Needed is second. Use Indeterminate when evidence is insufficient.`.slice(0,1800);
  const criteria:Record<string,string>={};
  for(const l of labels){
    const text=`${l.displayName}: ${l.description} ${l.guidance}`.replace(/\s+/g,' ').trim();
    criteria[l.id]=text.slice(0,120);
  }
  if(JSON.stringify(criteria).length>2000) throw new Error('Jev criteria exceed 2000 characters');
  return {type:'choice',instructions,criteria};
}
