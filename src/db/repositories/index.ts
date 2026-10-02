import type { AppDatabase } from '../client.ts';
const j=(v:unknown)=>JSON.stringify(v ?? null); const p=<T>(v:unknown):T=>v ? JSON.parse(String(v)) as T : (null as T);
const configRow=(r:any)=>r&&({hash:r.hash,provider:r.provider,model:r.model,globalInstructions:r.global_instructions,taxonomyJson:r.taxonomy_json,createdAt:r.created_at,active:!!r.active});
const auditRow=(r:any)=>r&&({messageId:r.message_id,threadId:r.thread_id,labelId:r.label_id,configHash:r.config_hash,confidence:r.confidence,probabilities:p(r.probabilities_json),provider:r.provider,model:r.model,usage:p(r.usage_json),processedAt:r.processed_at});
export function createRepositories(db: AppDatabase) {
  const installation={
    get(){ const row=db.prepare('SELECT * FROM installation WHERE id=1').get() as any; if(!row)return null; return {accountEmail:row.account_email, encryptedRefreshToken:row.encrypted_refresh_token, startupWatermarkMs:row.startup_watermark_ms, processedLabelId:row.processed_label_id, paused:!!row.paused, needsReconnect:!!row.needs_reconnect, reconnectReason:row.reconnect_reason, pollIntervalSeconds:row.poll_interval_seconds,maxPerMinute:row.max_per_minute,maxPerHour:row.max_per_hour,maxPerDay:row.max_per_day,backlogBatchSize:row.backlog_batch_size,backlogConcurrency:row.backlog_concurrency,dailySpendCents:row.daily_spend_cents,deferReason:row.defer_reason,deferUntil:row.defer_until,lastPollAt:row.last_poll_at,lastPollStatus:row.last_poll_status}; },
    upsert(x:any){ db.prepare(`INSERT INTO installation(id,account_email,encrypted_refresh_token,startup_watermark_ms,processed_label_id,paused,needs_reconnect) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_email=excluded.account_email, encrypted_refresh_token=COALESCE(excluded.encrypted_refresh_token,installation.encrypted_refresh_token), startup_watermark_ms=excluded.startup_watermark_ms, processed_label_id=COALESCE(excluded.processed_label_id,installation.processed_label_id), paused=excluded.paused, needs_reconnect=excluded.needs_reconnect`).run(x.accountEmail,x.encryptedRefreshToken??null,x.startupWatermarkMs,x.processedLabelId??null,x.paused?1:0,x.needsReconnect?1:0); },
    patch(x:any){ const cur=this.get(); if(!cur) throw new Error('installation missing'); const merged={...cur,...x}; this.upsert(merged); const fields=['reconnectReason','pollIntervalSeconds','maxPerMinute','maxPerHour','maxPerDay','backlogBatchSize','backlogConcurrency','dailySpendCents','deferReason','deferUntil','lastPollAt','lastPollStatus']; const cols:any={reconnectReason:'reconnect_reason',pollIntervalSeconds:'poll_interval_seconds',maxPerMinute:'max_per_minute',maxPerHour:'max_per_hour',maxPerDay:'max_per_day',backlogBatchSize:'backlog_batch_size',backlogConcurrency:'backlog_concurrency',dailySpendCents:'daily_spend_cents',deferReason:'defer_reason',deferUntil:'defer_until',lastPollAt:'last_poll_at',lastPollStatus:'last_poll_status'}; for(const f of fields) if(f in x) db.prepare(`UPDATE installation SET ${cols[f]}=? WHERE id=1`).run(x[f]??null); }
  };
  const config={
    save(x:any){ if(x.active) db.exec('UPDATE classifier_configs SET active=0'); db.prepare('INSERT OR REPLACE INTO classifier_configs(hash,provider,model,global_instructions,taxonomy_json,created_at,active) VALUES(?,?,?,?,?,?,?)').run(x.hash,x.provider,x.model,x.globalInstructions,x.taxonomyJson,x.createdAt,x.active?1:0); },
    getActive(){return configRow(db.prepare('SELECT * FROM classifier_configs WHERE active=1 ORDER BY created_at DESC LIMIT 1').get());},
    get(hash:string){return configRow(db.prepare('SELECT * FROM classifier_configs WHERE hash=?').get(hash));},
    listAll(){return (db.prepare('SELECT * FROM classifier_configs ORDER BY created_at').all() as any[]).map(configRow);}
  };
  const attempt={
    saveSuccess(x:any){db.prepare('INSERT OR REPLACE INTO classification_attempts(message_id,config_hash,label_id,probabilities_json,confidence,provider,model,usage_json,created_at,status) VALUES(?,?,?,?,?,?,?,?,?,\'success\')').run(x.messageId,x.configHash,x.labelId,j(x.probabilities),x.confidence??null,x.provider,x.model,j(x.usage),x.createdAt);},
    getSuccessful(messageId:string){const r=db.prepare("SELECT * FROM classification_attempts WHERE message_id=? AND status='success' ORDER BY created_at DESC LIMIT 1").get(messageId) as any; return r&&{messageId:r.message_id,configHash:r.config_hash,labelId:r.label_id,probabilities:p(r.probabilities_json),confidence:r.confidence,provider:r.provider,model:r.model,usage:p(r.usage_json),createdAt:r.created_at};}
  };
  const audit={
    complete(x:any){db.prepare('INSERT OR REPLACE INTO message_audits(message_id,thread_id,label_id,config_hash,confidence,probabilities_json,provider,model,usage_json,processed_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(x.messageId,x.threadId,x.labelId,x.configHash,x.confidence??null,j(x.probabilities),x.provider,x.model,j(x.usage),x.processedAt);},
    get(messageId:string){return auditRow(db.prepare('SELECT * FROM message_audits WHERE message_id=?').get(messageId));},
    list(limit=100){return (db.prepare('SELECT * FROM message_audits ORDER BY processed_at DESC LIMIT ?').all(limit) as any[]).map(auditRow);},
    addCorrection(x:any){db.prepare('INSERT INTO manual_corrections(message_id,from_label_id,to_label_id,corrected_at) VALUES(?,?,?,?)').run(x.messageId,x.fromLabelId,x.toLabelId,x.correctedAt); db.prepare('UPDATE message_audits SET label_id=? WHERE message_id=?').run(x.toLabelId,x.messageId);},
    listCorrections(messageId:string){return db.prepare('SELECT message_id as messageId, from_label_id as fromLabelId, to_label_id as toLabelId, corrected_at as correctedAt FROM manual_corrections WHERE message_id=? ORDER BY corrected_at').all(messageId) as any[];}
  };
  const backlog={
    create(x:any){const res=db.prepare('INSERT INTO backlog_jobs(range_json,status,total,processed,failed,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(x.rangeJson,x.status,x.total,x.processed,x.failed,x.createdAt,x.updatedAt); return this.get(Number(res.lastInsertRowid))!;},
    get(id:number){const r=db.prepare('SELECT * FROM backlog_jobs WHERE id=?').get(id) as any; return r&&{id:r.id,rangeJson:r.range_json,status:r.status,total:r.total,processed:r.processed,failed:r.failed,createdAt:r.created_at,updatedAt:r.updated_at};},
    update(id:number,x:any){const cur=this.get(id); if(!cur) throw new Error('job missing'); const m={...cur,...x}; db.prepare('UPDATE backlog_jobs SET status=?,total=?,processed=?,failed=?,updated_at=? WHERE id=?').run(m.status,m.total,m.processed,m.failed,m.updatedAt,id);},
    list(limit=20){return db.prepare('SELECT * FROM backlog_jobs ORDER BY updated_at DESC LIMIT ?').all(limit).map((r:any)=>({id:r.id,rangeJson:r.range_json,status:r.status,total:r.total,processed:r.processed,failed:r.failed,createdAt:r.created_at,updatedAt:r.updated_at}));},
    addFailure(jobId:number,messageId:string,kind:string,createdAt:number){db.prepare('INSERT OR IGNORE INTO backlog_failures(job_id,message_id,kind,created_at) VALUES(?,?,?,?)').run(jobId,messageId,kind,createdAt);},
    listFailureIds(jobId:number){return (db.prepare('SELECT message_id FROM backlog_failures WHERE job_id=?').all(jobId) as any[]).map(r=>String(r.message_id));},
    listFailures(jobId:number){return db.prepare('SELECT message_id as messageId,kind,created_at as createdAt FROM backlog_failures WHERE job_id=? ORDER BY created_at').all(jobId) as any[];}
  };
  const usage={
    add(x:any){db.prepare('INSERT INTO usage_events(kind,input_tokens,cost_cents,created_at) VALUES(?,?,?,?)').run(x.kind,x.inputTokens??null,x.costCents??null,x.createdAt);},
    listSince(ms:number){return db.prepare('SELECT kind,input_tokens as inputTokens,cost_cents as costCents,created_at as createdAt FROM usage_events WHERE created_at>=? ORDER BY created_at').all(ms) as any[];}
  };
  const error={
    add(x:any){db.prepare('INSERT INTO processing_errors(stage,category,provider,status,detail,message_id,created_at) VALUES(?,?,?,?,?,?,?)').run(x.stage,x.category,x.provider??null,x.status??null,x.detail??null,x.messageId??null,x.createdAt);},
    list(limit=20){return db.prepare('SELECT stage,category,provider,status,detail,message_id as messageId,created_at as createdAt FROM processing_errors ORDER BY created_at DESC LIMIT ?').all(limit) as any[];}
  };
  return {installation,config,attempt,audit,backlog,usage,error};
}
export type Repositories = ReturnType<typeof createRepositories>;
