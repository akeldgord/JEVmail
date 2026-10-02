import { getRuntimeRepositories } from '../../../db/runtime.ts';
import { buildRateLimitStatus } from '../../../services/dashboard-service.ts';
import { saveProcessingSettings,setProcessingPaused } from './actions.ts';
import { BacklogForm } from '../../../ui/components/backlog-form.tsx';
import { BacklogJobControls } from '../../../ui/components/backlog-job-controls.tsx';

function reasonLabel(reason:string|null){return reason==='per_minute'?'minute limit':reason==='per_hour'?'hourly limit':reason==='per_day'?'daily limit':reason==='daily_spend'?'daily spend limit':'rate limit';}

export default function Processing(){
  const repos=getRuntimeRepositories();
  const i=repos.installation.get();
  if(!i)return <p>Complete Google sign-in first.</p>;
  const jobs=repos.backlog.list(10);
  const quota=buildRateLimitStatus(repos);
  const reset=quota?.deferUntil?new Date(quota.deferUntil).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):null;
  return <>
    <h1>Processing</h1>
    {quota&&(quota.deferred||quota.nearLimit)?<section style={{marginBottom:16,padding:14,border:'1px solid #f59e0b',background:'#fffbeb',borderRadius:10}}>
      <strong>{quota.deferred?'Rate limited':'Approaching rate limit'}</strong>
      {quota.deferred?<p style={{margin:'6px 0'}}>Processing is waiting on the {reasonLabel(quota.reason)}{reset?`. Resets at ${reset}`:''}. Backlog will resume automatically.</p>:<p style={{margin:'6px 0'}}>One or more processing windows are above 80% of their configured limit.</p>}
      <div style={{fontSize:13,color:'#4b5563'}}>{quota.windows.map(w=><span key={w.key} style={{marginRight:16}}>{w.key}: {w.used}/{w.cap}</span>)}</div>
    </section>:null}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:16}}>
      <form action={saveProcessingSettings} style={{background:'white',padding:16,border:'1px solid #e5e7eb',borderRadius:12,display:'grid',gap:9}}>
        <h2>Limits</h2>
        {[
          ['pollIntervalSeconds','Poll interval (seconds)',i.pollIntervalSeconds],
          ['maxPerMinute','Max classifications / minute',i.maxPerMinute],
          ['maxPerHour','Max classifications / hour',i.maxPerHour],
          ['maxPerDay','Max classifications / day',i.maxPerDay],
          ['backlogBatchSize','Backlog batch size',i.backlogBatchSize],
          ['dailySpendCents','Daily spend ceiling (cents)',i.dailySpendCents??'']
        ].map(([name,label,value])=><label key={String(name)}>{label}<input name={String(name)} type="number" min="1" defaultValue={value as any} style={{display:'block',width:'100%',boxSizing:'border-box'}}/></label>)}
        <button>Save settings</button>
      </form>
      <section style={{background:'white',padding:16,border:'1px solid #e5e7eb',borderRadius:12}}>
        <h2>Worker</h2>
        <p>Status: <strong>{i.needsReconnect?'needs reconnect':i.paused?'paused':quota?.deferred?'waiting for rate limit':'running'}</strong></p>
        <form action={setProcessingPaused}><input type="hidden" name="paused" value={i.paused?'false':'true'}/><button>{i.paused?'Resume processing':'Pause processing'}</button></form>
        <p style={{fontSize:13,color:'#6b7280'}}>Last poll: {i.lastPollAt?new Date(i.lastPollAt).toLocaleString():'Not recorded'} {i.lastPollStatus?`(${i.lastPollStatus})`:''}</p>
      </section>
    </div>
    <div style={{marginTop:16}}><BacklogForm/></div>
    <h2>Backlog jobs</h2>
    <div style={{display:'grid',gap:8}}>{jobs.map((j:any)=>{
      const waiting=j.status==='deferred'&&quota?.deferred;
      return <div key={j.id} style={{background:'white',padding:12,border:'1px solid #e5e7eb',borderRadius:10,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div><strong>#{j.id} {waiting?`waiting (${reasonLabel(quota?.reason??null)}${reset?`, resumes ${reset}`:''})`:j.status}</strong><div style={{fontSize:13}}>{j.processed}/{j.total} processed · {j.failed} failed</div></div>
        <BacklogJobControls job={j}/>
      </div>;
    })}</div>
  </>;
}
