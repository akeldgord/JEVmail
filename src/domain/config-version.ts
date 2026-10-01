import { createHash } from 'node:crypto';
import type { ClassificationTaxonomy } from './taxonomy.ts';

export type ClassifierConfigSnapshot = {
  provider: string;
  model: string;
  globalInstructions: string;
  taxonomy: ClassificationTaxonomy;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export function hashClassifierConfig(config: ClassifierConfigSnapshot): string {
  return createHash('sha256').update(canonical(config)).digest('hex');
}

export function validatePinnedModel(model: string): boolean {
  const lower = model.toLowerCase();
  return Boolean(model.trim()) && !lower.includes('latest') && !lower.includes('preview') && /\d/.test(model);
}
