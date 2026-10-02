function startOfUtcDay(now:number){const d=new Date(now);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());}

export function buildRateLimitStatus(repos:any,now=Date.now()){
  const i=repos.installation.get();
  if(!i)return null;
  const dayStart=startOfUtcDay(now);
  const usage=(repos.usage.listSince(Math.min(dayStart,now-3_600_000))??[]).filter((x:any)=>x.kind==='classification'&&x.createdAt<=now);
  const minute=usage.filter((x:any)=>x.createdAt>now-60_000).length;
  const hour=usage.filter((x:any)=>x.createdAt>now-3_600_000).length;
  const day=usage.filter((x:any)=>x.createdAt>=dayStart).length;
  const windows=[
    {key:'minute',used:minute,cap:i.maxPerMinute},
    {key:'hour',used:hour,cap:i.maxPerHour},
    {key:'day',used:day,cap:i.maxPerDay},
  ];
  const deferred=Boolean(i.deferUntil&&i.deferUntil>now);
  const nearLimit=windows.some(w=>w.cap>0&&w.used/w.cap>=0.8);
  return{deferred,nearLimit,reason:i.deferReason??null,deferUntil:i.deferUntil??null,windows};
}

export function buildDashboardOverview(repos:any,now=Date.now()){
  const dayStart=startOfUtcDay(now);
  const audits=(repos.audit.list(5000)??[]).filter((x:any)=>x.processedAt>=dayStart&&x.processedAt<=now);
  let correctionsToday=0;
  for(const a of audits)correctionsToday+=(repos.audit.listCorrections(a.messageId)??[]).filter((c:any)=>c.correctedAt==null||c.correctedAt>=dayStart).length;
  const usage=(repos.usage.listSince(dayStart)??[]).filter((x:any)=>x.kind==='classification'&&x.createdAt<=now);
  const inputTokensToday=usage.reduce((n:number,x:any)=>n+(typeof x.inputTokens==='number'?x.inputTokens:0),0);
  const costsKnown=usage.length>0&&usage.every((x:any)=>typeof x.costCents==='number');
  const spendCentsToday=costsKnown?usage.reduce((n:number,x:any)=>n+x.costCents,0):null;
  const estimatedSpendUsdToday=(inputTokensToday/1_000_000)*0.042;
  const jobs=repos.backlog.list?.(20)??[];
  const active=jobs.find((x:any)=>['pending','running','paused','deferred'].includes(x.status));
  const installation=repos.installation.get();
  const recentErrors=repos.error?.list?.(10)??[];
  const processingStatus=installation?.needsReconnect?'needs_reconnect':installation?.paused?'paused':installation?.deferUntil&&installation.deferUntil>now?'deferred':'running';
  return{processingStatus,classificationsToday:audits.length,correctionsToday,correctionRate:audits.length?correctionsToday/audits.length:0,inputTokensToday,spendCentsToday,spendAvailable:costsKnown,estimatedSpendUsdToday,pendingBacklog:active?Math.max(0,active.total-active.processed-active.failed):0,failedBacklog:active?.failed??0,lastPollAt:installation?.lastPollAt??null,lastPollStatus:installation?.lastPollStatus??null,recentErrors};
}
