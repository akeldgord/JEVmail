import type { ClassificationTaxonomy } from '../domain/taxonomy.ts';
export type ClassificationUsage={input_tokens?:number;output_tokens?:number;cost_cents?:number};
export type ClassificationRequest={gmailMessageId:string;serializedState:string;taxonomy:ClassificationTaxonomy;globalInstructions:string;provider:string;model:string;configHash:string;testRun?:boolean};
export type ClassificationResult={labelId:string;probabilities:Record<string,number>;confidence:number|null;provider:string;model:string;usage:ClassificationUsage;configHash:string;idempotencyKey:string};
export interface Classifier{classify(request:ClassificationRequest):Promise<ClassificationResult>;}
