import { DEFAULT_GLOBAL_INSTRUCTIONS,DEFAULT_TAXONOMY } from '../domain/defaults.ts';
import { hashClassifierConfig } from '../domain/config-version.ts';
import type { ClassificationLabel, ClassificationTaxonomy } from '../domain/taxonomy.ts';
import { validateTaxonomy } from '../domain/taxonomy.ts';
import { validatePromptBudget } from '../classifier/prompt-builder.ts';
import type { GmailClient } from '../gmail/types.ts';
import { ensureClassificationLabels,ensureProcessedLabel } from '../gmail/labels.ts';

function assertConfigValid(taxonomy:ClassificationTaxonomy,instructions:string){
  const taxonomyValidation=validateTaxonomy(taxonomy);
  if(!taxonomyValidation.ok)throw new Error(taxonomyValidation.errors.join('; '));
  const budget=validatePromptBudget(taxonomy,instructions);
  if(!budget.ok)throw new Error(budget.errors.join(' '));
}

export async function ensureInstallationSetup(args:{email:string;gmail:GmailClient;repos:any;model:string;provider?:string;now?:number}){
  const now=args.now??Date.now();
  const existing=args.repos.installation.get();
  if(existing&&existing.accountEmail.toLowerCase()!==args.email.toLowerCase())throw new Error('bound account mismatch');
  const mapping=await ensureClassificationLabels(args.gmail,DEFAULT_TAXONOMY);
  const processed=await ensureProcessedLabel(args.gmail);
  const taxonomy=structuredClone(DEFAULT_TAXONOMY);
  for(const label of taxonomy.labels)label.gmailLabelId=mapping[label.id];
  assertConfigValid(taxonomy,DEFAULT_GLOBAL_INSTRUCTIONS);
  const snapshot={provider:args.provider??'jev',model:args.model,globalInstructions:DEFAULT_GLOBAL_INSTRUCTIONS,taxonomy};
  const hash=hashClassifierConfig(snapshot);
  if(!args.repos.config.get(hash)){
    args.repos.config.save({
      hash,
      provider:snapshot.provider,
      model:snapshot.model,
      globalInstructions:snapshot.globalInstructions,
      taxonomyJson:JSON.stringify(taxonomy),
      createdAt:now,
      active:true
    });
  }
  args.repos.installation.upsert({
    accountEmail:args.email,
    startupWatermarkMs:existing?.startupWatermarkMs??now,
    processedLabelId:processed.id,
    paused:existing?.paused??false,
    needsReconnect:false,
    encryptedRefreshToken:existing?.encryptedRefreshToken??null
  });
  return {configHash:hash,processedLabelId:processed.id};
}

export async function mergeDefaultTaxonomy(args:{gmail:GmailClient;repos:any;now?:number;defaults?:ClassificationTaxonomy}){
  const now=args.now??Date.now();
  const active=args.repos.config.getActive();
  if(!active)return {added:[] as string[],pending:[] as string[],configHash:null};
  const taxonomy=JSON.parse(active.taxonomyJson) as ClassificationTaxonomy;
  const defaults=args.defaults??DEFAULT_TAXONOMY;
  const existingIds=new Set(taxonomy.labels.map(label=>label.id));
  const missing=defaults.labels
    .filter(label=>!existingIds.has(label.id))
    .toSorted((a,b)=>a.priority-b.priority);
  if(!missing.length)return {added:[] as string[],pending:[] as string[],configHash:active.hash};

  const selected:ClassificationLabel[]=[];
  const pending:ClassificationLabel[]=[];
  for(const defaultLabel of missing){
    const candidate=structuredClone(taxonomy);
    candidate.labels.push(...selected.map(label=>structuredClone(label)),structuredClone(defaultLabel));
    const taxonomyValidation=validateTaxonomy(candidate);
    const budget=validatePromptBudget(candidate,active.globalInstructions);
    if(taxonomyValidation.ok&&budget.ok)selected.push(structuredClone(defaultLabel));
    else pending.push(structuredClone(defaultLabel));
  }

  if(selected.length){
    const mapping=await ensureClassificationLabels(args.gmail,{labels:selected});
    for(const label of selected)label.gmailLabelId=mapping[label.id];
    taxonomy.labels.push(...selected);
    assertConfigValid(taxonomy,active.globalInstructions);
  }

  let configHash=active.hash;
  if(selected.length){
    const snapshot={provider:active.provider,model:active.model,globalInstructions:active.globalInstructions,taxonomy};
    configHash=hashClassifierConfig(snapshot);
    args.repos.config.save({
      hash:configHash,
      provider:snapshot.provider,
      model:snapshot.model,
      globalInstructions:snapshot.globalInstructions,
      taxonomyJson:JSON.stringify(taxonomy),
      createdAt:now,
      active:true
    });
  }

  if(pending.length&&!args.repos.error?.hasConfigWarning?.(configHash,'default_taxonomy_pending')){
    args.repos.error?.add({
      stage:'classifier_config',
      category:'default_taxonomy_pending',
      provider:active.provider,
      status:null,
      detail:`${pending.length} new default categor${pending.length===1?'y is':'ies are'} pending because the prompt budget is full. Disable a label or shorten guidance to add ${pending.length===1?'it':'them'}.`,
      configHash,
      messageId:null,
      createdAt:now
    });
  }

  return {added:selected.map(label=>label.id),pending:pending.map(label=>label.id),configHash};
}
