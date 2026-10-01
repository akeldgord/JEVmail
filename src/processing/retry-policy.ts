import { JevApiError } from '../classifier/jev-client.ts';

export type ErrorDisposition = 'transient' | 'permanent';

function errorStatus(error:unknown):number{return Number((error as any)?.status ?? (error as any)?.response?.status ?? 0);}
function errorCode(error:unknown):string{return String((error as any)?.code ?? (error as any)?.response?.data?.error ?? '').toLowerCase();}
function errorMessage(error:unknown):string{return String((error as any)?.message ?? (error as any)?.response?.data?.error_description ?? '').toLowerCase();}

export function requiresGmailReconnect(error:unknown):boolean{
  const status=errorStatus(error);const code=errorCode(error);const message=errorMessage(error);
  return status===401||status===403||code.includes('invalid_grant')||message.includes('invalid_grant');
}

export function classifyOperationalError(error: unknown): ErrorDisposition {
  if (error instanceof JevApiError) return error.transient ? 'transient' : 'permanent';
  const status = errorStatus(error);
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  if (status >= 400 && status < 500) return 'permanent';
  const code = String((error as any)?.code ?? '');
  if (['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENETUNREACH','EAI_AGAIN'].includes(code)) return 'transient';
  return 'permanent';
}

export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  constructor(options: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }) {if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) throw new Error('maxAttempts must be >= 1');this.maxAttempts = options.maxAttempts;this.baseDelayMs = options.baseDelayMs;this.maxDelayMs = options.maxDelayMs;}
  delayForAttempt(completedAttempts: number): number | null {if (completedAttempts >= this.maxAttempts) return null;return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, completedAttempts - 1));}
}
