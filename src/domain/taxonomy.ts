export type SemanticRole = 'reply_needed' | 'action_needed' | 'indeterminate' | 'standard';
export type ClassificationLabel = {
  id: string;
  displayName: string;
  description: string;
  guidance: string;
  enabled: boolean;
  priority: number;
  semanticRole: SemanticRole;
  gmailLabelName: string;
  gmailLabelId?: string;
};
export type ClassificationTaxonomy = { labels: ClassificationLabel[] };
export type TaxonomyValidation = { ok: true } | { ok: false; errors: string[] };

const GMAIL_SYSTEM_LABEL_IDS = new Set(['INBOX','SPAM','TRASH','UNREAD','STARRED','IMPORTANT','SENT','DRAFT','CHAT','CATEGORY_PERSONAL','CATEGORY_SOCIAL','CATEGORY_PROMOTIONS','CATEGORY_UPDATES','CATEGORY_FORUMS']);
export function isGmailSystemLabelId(id:string):boolean{return GMAIL_SYSTEM_LABEL_IDS.has(id.toUpperCase())||id.toUpperCase().startsWith('CATEGORY_');}

export function validateTaxonomy(taxonomy: ClassificationTaxonomy): TaxonomyValidation {
  const errors: string[] = [];
  if (!taxonomy.labels?.length) errors.push('taxonomy must contain labels');
  const ids = new Set<string>();
  for (const label of taxonomy.labels ?? []) {
    if (!/^[a-z0-9_]+$/.test(label.id)) errors.push(`invalid id: ${label.id}`);
    if (ids.has(label.id)) errors.push(`duplicate id: ${label.id}`);
    ids.add(label.id);
    if (!label.displayName.trim()) errors.push(`empty display name: ${label.id}`);
  }
  const gmailIds=new Set<string>();
  for(const label of taxonomy.labels ?? []){if(!label.gmailLabelId)continue;if(isGmailSystemLabelId(label.gmailLabelId))errors.push(`Gmail system label cannot be used for classification: ${label.gmailLabelId}`);if(gmailIds.has(label.gmailLabelId))errors.push(`duplicate Gmail label mapping: ${label.gmailLabelId}`);gmailIds.add(label.gmailLabelId);}
  const indeterminate = taxonomy.labels.find(l => l.semanticRole === 'indeterminate');
  if (!indeterminate) errors.push('indeterminate semantic role is required');
  else if (!indeterminate.enabled) errors.push('indeterminate cannot be disabled');
  const reply = taxonomy.labels.filter(l => l.semanticRole === 'reply_needed');
  const action = taxonomy.labels.filter(l => l.semanticRole === 'action_needed');
  if (reply.length !== 1) errors.push('exactly one reply_needed semantic role is required');
  if (action.length !== 1) errors.push('exactly one action_needed semantic role is required');
  if (taxonomy.labels.filter(l => l.enabled).length < 2) errors.push('at least two labels must be enabled');
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function enabledLabels(taxonomy: ClassificationTaxonomy): ClassificationLabel[] {
  return taxonomy.labels.filter(l => l.enabled).toSorted((a,b) => a.priority - b.priority);
}
