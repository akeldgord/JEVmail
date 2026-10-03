'use server';

import { revalidatePath } from 'next/cache';
import { requireOperationalApp } from '../../../auth/dashboard-auth.ts';
import type { ClassificationLabel, ClassificationTaxonomy } from '../../../domain/taxonomy.ts';
import { isGmailSystemLabelId, validateTaxonomy } from '../../../domain/taxonomy.ts';
import { hashClassifierConfig } from '../../../domain/config-version.ts';
import { validatePromptBudget } from '../../../classifier/prompt-builder.ts';
import { DEFAULT_TAXONOMY } from '../../../domain/defaults.ts';
import { ensureClassificationLabels } from '../../../gmail/labels.ts';

const DEFAULT_IDS=new Set(DEFAULT_TAXONOMY.labels.map(label=>label.id));
const PROTECTED_ROLES=new Set(['reply_needed','action_needed','indeterminate']);

function requireValidConfig(taxonomy:ClassificationTaxonomy,globalInstructions:string){
  const taxonomyValidation=validateTaxonomy(taxonomy);
  if(!taxonomyValidation.ok)throw new Error(taxonomyValidation.errors.join('; '));
  const budget=validatePromptBudget(taxonomy,globalInstructions);
  if(!budget.ok){
    throw new Error(`${budget.errors.join(' ')} Prompt budget: ${budget.sizes.criteriaJsonChars.toLocaleString()} / 8,000 criteria chars; ${budget.sizes.instructionsChars.toLocaleString()} / 4,000 instruction chars; ${budget.sizes.enabledLabelCount} / 20 labels.`);
  }
  return budget;
}

function saveSnapshot(app:any,active:any,taxonomy:ClassificationTaxonomy){
  requireValidConfig(taxonomy,active.globalInstructions);
  const snapshot={provider:active.provider,model:active.model,globalInstructions:active.globalInstructions,taxonomy};
  const hash=hashClassifierConfig(snapshot);
  app.repos.config.save({
    hash,
    provider:snapshot.provider,
    model:snapshot.model,
    globalInstructions:snapshot.globalInstructions,
    taxonomyJson:JSON.stringify(taxonomy),
    createdAt:Date.now(),
    active:true
  });
  revalidatePath('/dashboard/labels');
  revalidatePath('/dashboard/classifier');
  return hash;
}

export async function saveLabelAction(formData:FormData){
  const app=await requireOperationalApp();
  const active=app.repos.config.getActive();
  if(!active)throw new Error('active classifier config missing');
  const taxonomy=JSON.parse(active.taxonomyJson) as ClassificationTaxonomy;
  const id=String(formData.get('labelId')??'');
  const label=taxonomy.labels.find(l=>l.id===id);
  if(!label)throw new Error('unknown label');
  label.displayName=String(formData.get('displayName')??'').trim();
  label.guidance=String(formData.get('guidance')??'').trim();
  const protectedRole=PROTECTED_ROLES.has(label.semanticRole);
  label.enabled=protectedRole?true:formData.get('enabled')==='on';
  const gmailLabelId=String(formData.get('gmailLabelId')??'');
  const gmailLabels=await app.gmail.listLabels();
  const mapped=gmailLabels.find(l=>l.id===gmailLabelId);
  if(!mapped||mapped.type==='system'||isGmailSystemLabelId(mapped.id))throw new Error('Classification labels must map to Gmail user labels, not system labels.');
  label.gmailLabelId=mapped.id;
  label.gmailLabelName=mapped.name;
  saveSnapshot(app,active,taxonomy);
}

export async function addLabelAction(formData:FormData){
  const app=await requireOperationalApp();
  const active=app.repos.config.getActive();
  if(!active)throw new Error('active classifier config missing');
  const taxonomy=JSON.parse(active.taxonomyJson) as ClassificationTaxonomy;
  const id=String(formData.get('id')??'').trim().toLowerCase();
  const displayName=String(formData.get('displayName')??'').trim();
  const description=String(formData.get('description')??'').trim();
  const guidance=String(formData.get('guidance')??'').trim();
  if(!/^[a-z0-9_]+$/.test(id))throw new Error('Category id must use lowercase letters, numbers, and underscores only.');
  if(taxonomy.labels.some(label=>label.id===id))throw new Error(`Category id already exists: ${id}`);
  if(!displayName)throw new Error('Category display name is required.');
  const highestPriority=Math.max(...taxonomy.labels.filter(label=>label.semanticRole!=='indeterminate').map(label=>label.priority),0);
  const requestedPriority=Number(formData.get('priority'));
  const priority=Number.isFinite(requestedPriority)&&requestedPriority>0?Math.floor(requestedPriority):highestPriority+10;
  const label:ClassificationLabel={
    id,
    displayName,
    description,
    guidance,
    enabled:true,
    priority,
    semanticRole:'standard',
    gmailLabelName:`JEVmail/${displayName}`
  };
  taxonomy.labels.push(label);

  const requestedGmailId=String(formData.get('gmailLabelId')??'').trim();
  if(requestedGmailId){
    const gmailLabels=await app.gmail.listLabels();
    const mapped=gmailLabels.find(item=>item.id===requestedGmailId);
    if(!mapped||mapped.type==='system'||isGmailSystemLabelId(mapped.id))throw new Error('Classification labels must map to Gmail user labels, not system labels.');
    label.gmailLabelId=mapped.id;
    label.gmailLabelName=mapped.name;
  }else{
    const mapping=await ensureClassificationLabels(app.gmail,{labels:[label]});
    label.gmailLabelId=mapping[id];
  }

  saveSnapshot(app,active,taxonomy);
}

export async function deleteLabelAction(formData:FormData){
  const app=await requireOperationalApp();
  const active=app.repos.config.getActive();
  if(!active)throw new Error('active classifier config missing');
  const taxonomy=JSON.parse(active.taxonomyJson) as ClassificationTaxonomy;
  const id=String(formData.get('labelId')??'');
  const label=taxonomy.labels.find(item=>item.id===id);
  if(!label)throw new Error('unknown label');
  if(DEFAULT_IDS.has(id)||PROTECTED_ROLES.has(label.semanticRole))throw new Error('Default and protected categories cannot be deleted.');
  if(label.enabled)throw new Error('Disable this category first, then delete it.');
  taxonomy.labels=taxonomy.labels.filter(item=>item.id!==id);
  saveSnapshot(app,active,taxonomy);
}
