import { JevApiError } from '../classifier/jev-client.ts';

export type ErrorDisposition = 'transient' | 'permanent';
export type OperationalErrorDetails = {
  provider: 'classifier' | 'gmail' | 'network' | 'app';
  status: number | null;
  detail: string;
};

function errorStatus(error:unknown):number {
  return Number((error as any)?.status ?? (error as any)?.response?.status ?? 0);
}
function errorCode(error:unknown):string {
  return String((error as any)?.code ?? '').toLowerCase();
}
function errorText(error:unknown):string {
  const value = {
    message:(error as any)?.message,
    code:(error as any)?.code,
    errors:(error as any)?.errors,
    response:(error as any)?.response?.data,
  };
  try { return JSON.stringify(value).toLowerCase(); } catch { return String((error as any)?.message ?? '').toLowerCase(); }
}
function truncate(value:string,max=500){return value.length<=max?value:`${value.slice(0,max-1)}…`;}

export function isGmailQuotaError(error:unknown):boolean {
  if (error instanceof JevApiError) return false;
  const status=errorStatus(error);
  if(status!==403&&status!==429)return false;
  const text=errorText(error);
  return [
    'ratelimitexceeded','rate_limit_exceeded','usagelimits','quota exceeded',
    'quota metric','user-rate limit exceeded','daily limit exceeded'
  ].some(signal=>text.includes(signal));
}

export function requiresGmailReconnect(error:unknown):boolean {
  if(error instanceof JevApiError || isGmailQuotaError(error)) return false;
  const status=errorStatus(error);
  const text=errorText(error);
  if(text.includes('invalid_grant')) return true;
  if(status===401) return true;
  if(status!==403) return false;
  return [
    'insufficient authentication scopes','insufficientpermissions',
    'appnotauthorized','unauthorized client','unauthorized_client',
    'invalid credentials','autherror'
  ].some(signal=>text.includes(signal));
}

export function classifyOperationalError(error: unknown): ErrorDisposition {
  if (error instanceof JevApiError) return error.transient ? 'transient' : 'permanent';
  if (isGmailQuotaError(error)) return 'transient';
  const status = errorStatus(error);
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  if (status >= 400 && status < 500) return 'permanent';
  const code = String((error as any)?.code ?? '');
  if (['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENETUNREACH','EAI_AGAIN'].includes(code)) return 'transient';
  return 'permanent';
}

export function describeOperationalError(error:unknown):OperationalErrorDetails {
  const status=errorStatus(error)||null;
  if(error instanceof JevApiError) return {provider:'classifier',status,detail:truncate(`${status?`HTTP ${status}: `:''}${error.message||'classifier error'}`)};
  const code=errorCode(error);
  if(status || errorText(error).includes('gmail')) { const raw=String((error as any)?.message ?? code ?? 'Gmail error'); const reasons=JSON.stringify((error as any)?.errors ?? (error as any)?.response?.data?.error?.errors ?? ''); return {provider:'gmail',status,detail:truncate(`${status?`HTTP ${status}: `:''}${raw}${reasons&&reasons!=='""'?` ${reasons}`:''}`)}; }
  if(['econnreset','econnrefused','etimedout','enetunreach','eai_again'].includes(code)) return {provider:'network',status:null,detail:truncate(String((error as any)?.message ?? code))};
  return {provider:'app',status,detail:truncate(String((error as any)?.message ?? 'processing error'))};
}

export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  constructor(options: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) throw new Error('maxAttempts must be >= 1');
    this.maxAttempts = options.maxAttempts;this.baseDelayMs = options.baseDelayMs;this.maxDelayMs = options.maxDelayMs;
  }
  delayForAttempt(completedAttempts: number): number | null {
    if (completedAttempts >= this.maxAttempts) return null;
    return Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, completedAttempts - 1));
  }
}
