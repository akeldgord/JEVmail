export type RateWindow={key:string;used:number;cap:number};
export type RateLimitStatus={deferred:boolean;nearLimit:boolean;reason:string|null;deferUntil:number|null;windows:RateWindow[]};

function reasonLabel(reason:string|null){
  return reason==='per_minute'?'minute limit':reason==='per_hour'?'hourly limit':reason==='per_day'?'daily limit':reason==='daily_spend'?'daily spend limit':'rate limit';
}

export function RateLimitBanner({quota}:{quota:RateLimitStatus|null}){
  if(!quota||(!quota.deferred&&!quota.nearLimit))return null;
  const reset=quota.deferUntil?new Date(quota.deferUntil).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):null;
  return <section data-testid="rate-limit-banner" style={{marginBottom:16,padding:14,border:'1px solid #f59e0b',background:'#fffbeb',borderRadius:10}}>
    <strong>{quota.deferred?'Rate limited':'Approaching rate limit'}</strong>
    {quota.deferred
      ?<p style={{margin:'6px 0'}}>Processing is waiting on the {reasonLabel(quota.reason)}{reset?`. Resets at ${reset}`:''}. Backlog will resume automatically.</p>
      :<p style={{margin:'6px 0'}}>One or more processing windows are above 80% of their configured limit.</p>}
    <div style={{fontSize:13,color:'#4b5563'}}>{quota.windows.map(w=><span key={w.key} style={{marginRight:16}}>{w.key}: {w.used}/{w.cap}</span>)}</div>
  </section>;
}

export function backlogStatusText(status:string,quota:RateLimitStatus|null){
  if(status!=='deferred'||!quota?.deferred)return status;
  const reset=quota.deferUntil?new Date(quota.deferUntil).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):null;
  return `waiting (${reasonLabel(quota.reason)}${reset?`, resumes ${reset}`:''})`;
}
