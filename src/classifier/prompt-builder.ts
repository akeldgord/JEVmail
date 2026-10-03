import type { ClassificationLabel, ClassificationTaxonomy } from '../domain/taxonomy.ts';
import { enabledLabels } from '../domain/taxonomy.ts';

// Bounds are JEVmail application guardrails. Provider schema evidence and the credentialed probe live in docs/PROMPT-LIMITS.md.
export const MAX_ENABLED_LABELS=20;
export const CRITERIA_BUDGET_CHARS=8000;
export const CRITERION_MAX_CHARS=240;
export const INSTRUCTIONS_MAX_CHARS=4000;
export const SYSTEM_INSTRUCTIONS_SUFFIX='Return exactly one handling label. Reply Needed has highest precedence; Action Needed is second. Use Indeterminate when evidence is insufficient.';
export const MAX_GLOBAL_INSTRUCTIONS_CHARS=INSTRUCTIONS_MAX_CHARS-SYSTEM_INSTRUCTIONS_SUFFIX.length-1;

export type JevChoiceQuestion={type:'choice';instructions:string;criteria:Record<string,string>};
export type PromptBudgetSizes={criteriaJsonChars:number;instructionsChars:number;enabledLabelCount:number};
export type PromptBudgetValidation={ok:boolean;errors:string[];sizes:PromptBudgetSizes};
export type PreparedJevQuestion={question:JevChoiceQuestion;warnings:string[];sizes:PromptBudgetSizes};

function clean(value:string){return value.replace(/\s+/g,' ').trim();}

function smartSlice(value:string,max:number){
  if(value.length<=max)return value;
  if(max<8)return value.slice(0,max);
  const marker=' … ';
  const head=Math.max(1,Math.floor((max-marker.length)*0.62));
  const tail=Math.max(1,max-marker.length-head);
  return value.slice(0,head)+marker+value.slice(-tail);
}

export function fullCriterionText(label:ClassificationLabel){
  const display=clean(label.displayName);
  const guidance=clean(label.guidance);
  const description=clean(label.description);
  return [`${display}:`,guidance,description].filter(Boolean).join(' ');
}

export function buildCriterionText(label:ClassificationLabel){
  const display=clean(label.displayName);
  const guidance=clean(label.guidance);
  const description=clean(label.description);
  const prefix=`${display}: `;
  const preferred=prefix+guidance;
  if(preferred.length>=CRITERION_MAX_CHARS){
    return prefix+smartSlice(guidance,Math.max(1,CRITERION_MAX_CHARS-prefix.length));
  }
  if(!description)return preferred;
  const withDescription=`${preferred} ${description}`;
  return withDescription.length<=CRITERION_MAX_CHARS
    ?withDescription
    :`${preferred} ${smartSlice(description,Math.max(1,CRITERION_MAX_CHARS-preferred.length-1))}`;
}

function instructionText(globalInstructions:string){
  return `${globalInstructions.trim()}\n${SYSTEM_INSTRUCTIONS_SUFFIX}`;
}

function criteriaFor(labels:ClassificationLabel[]){
  const criteria:Record<string,string>={};
  for(const label of labels)criteria[label.id]=buildCriterionText(label);
  return criteria;
}

export function validatePromptBudget(taxonomy:ClassificationTaxonomy,globalInstructions:string):PromptBudgetValidation{
  const labels=enabledLabels(taxonomy);
  const criteria=criteriaFor(labels.slice(0,MAX_ENABLED_LABELS));
  const instructions=instructionText(globalInstructions);
  const sizes:PromptBudgetSizes={
    criteriaJsonChars:JSON.stringify(criteria).length,
    instructionsChars:instructions.length,
    enabledLabelCount:labels.length,
  };
  const errors:string[]=[];
  if(labels.length<2||labels.length>MAX_ENABLED_LABELS)errors.push(`Enabled label count is ${labels.length}; Jev choice supports 2-${MAX_ENABLED_LABELS}.`);
  for(const label of labels){
    const raw=fullCriterionText(label);
    if(raw.length>CRITERION_MAX_CHARS)errors.push(`${label.displayName} criterion is ${raw.length} chars; per-label budget is ${CRITERION_MAX_CHARS}. Shorten guidance or description.`);
  }
  if(sizes.criteriaJsonChars>CRITERIA_BUDGET_CHARS)errors.push(`Criteria JSON is ${sizes.criteriaJsonChars.toLocaleString()} chars; budget is ${CRITERIA_BUDGET_CHARS.toLocaleString()}. Shorten guidance or disable a label.`);
  if(instructions.length>INSTRUCTIONS_MAX_CHARS)errors.push(`Classifier instructions are ${instructions.length.toLocaleString()} chars; budget is ${INSTRUCTIONS_MAX_CHARS.toLocaleString()}. Shorten the global instructions.`);
  return {ok:errors.length===0,errors,sizes};
}

export function prepareJevQuestion(taxonomy:ClassificationTaxonomy,globalInstructions:string):PreparedJevQuestion{
  const allLabels=enabledLabels(taxonomy);
  const warnings:string[]=[];
  let labels=allLabels;
  if(allLabels.length>MAX_ENABLED_LABELS){
    const indeterminate=allLabels.find(label=>label.semanticRole==='indeterminate');
    labels=allLabels.slice(0,MAX_ENABLED_LABELS);
    if(indeterminate&&!labels.some(label=>label.id===indeterminate.id))labels=[...allLabels.slice(0,MAX_ENABLED_LABELS-1),indeterminate];
    warnings.push(`Enabled label count ${allLabels.length} exceeds ${MAX_ENABLED_LABELS}; only ${MAX_ENABLED_LABELS} labels were sent, preserving protected fallback roles.`);
  }
  for(const label of labels){
    const raw=fullCriterionText(label);
    if(raw.length>CRITERION_MAX_CHARS)warnings.push(`${label.displayName} criterion was truncated from ${raw.length} to ${CRITERION_MAX_CHARS} chars.`);
  }
  const criteria=criteriaFor(labels);
  const criteriaChars=JSON.stringify(criteria).length;
  if(criteriaChars>CRITERIA_BUDGET_CHARS)warnings.push(`Criteria JSON remains ${criteriaChars} chars after deterministic per-criterion truncation; provider limits may still reject it.`);
  const fullInstructions=instructionText(globalInstructions);
  const instructions=fullInstructions.slice(0,INSTRUCTIONS_MAX_CHARS);
  if(fullInstructions.length>INSTRUCTIONS_MAX_CHARS)warnings.push(`Classifier instructions were truncated from ${fullInstructions.length} to ${INSTRUCTIONS_MAX_CHARS} chars.`);
  return{
    question:{type:'choice',instructions,criteria},
    warnings,
    sizes:{criteriaJsonChars:JSON.stringify(criteria).length,instructionsChars:instructions.length,enabledLabelCount:labels.length}
  };
}

export function buildJevQuestion(taxonomy:ClassificationTaxonomy,globalInstructions:string):JevChoiceQuestion{
  return prepareJevQuestion(taxonomy,globalInstructions).question;
}
