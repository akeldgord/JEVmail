'use server';

import { revalidatePath } from 'next/cache';
import { requireOperationalApp } from '../../../auth/dashboard-auth.ts';
import type { ClassificationTaxonomy } from '../../../domain/taxonomy.ts';
import { hashClassifierConfig,validatePinnedModel } from '../../../domain/config-version.ts';
import { validatePromptBudget } from '../../../classifier/prompt-builder.ts';

export async function saveClassifierWithApp(app:any,formData:FormData){
  const active=app.repos.config.getActive();
  if(!active)throw new Error('active classifier config missing');
  const globalInstructions=String(formData.get('globalInstructions')??'').trim();
  const model=String(formData.get('model')??'').trim();
  if(!globalInstructions)throw new Error('instructions are required');
  if(!validatePinnedModel(model))throw new Error('Use a pinned model version, not latest/preview.');
  const taxonomy=JSON.parse(active.taxonomyJson) as ClassificationTaxonomy;
  const budget=validatePromptBudget(taxonomy,globalInstructions);
  if(!budget.ok){
    throw new Error(`${budget.errors.join(' ')} Prompt budget: ${budget.sizes.criteriaJsonChars.toLocaleString()} / 8,000 criteria chars; ${budget.sizes.instructionsChars.toLocaleString()} / 4,000 instruction chars; ${budget.sizes.enabledLabelCount} / 20 labels.`);
  }
  const snapshot={provider:active.provider,model,globalInstructions,taxonomy};
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
  return hash;
}

export async function saveClassifierAction(formData:FormData){
  const app=await requireOperationalApp();
  await saveClassifierWithApp(app,formData);
  revalidatePath('/dashboard/classifier');
  revalidatePath('/dashboard/labels');
}
