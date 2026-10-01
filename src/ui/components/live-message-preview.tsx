'use client';
import { useState } from 'react';
export function LiveMessagePreview({messageId}:{messageId:string}){
  const [message,setMessage]=useState<any>(null);const [busy,setBusy]=useState(false);
  return <div style={{marginTop:8}}><button disabled={busy} onClick={async()=>{setBusy(true);const response=await fetch(`/api/message/${encodeURIComponent(messageId)}`);setMessage(await response.json());setBusy(false);}}>{busy?'Loading…':message?'Refresh live message':'View live message'}</button>{message&&<div style={{marginTop:10,padding:12,background:'#f9fafb',borderRadius:8,maxWidth:760}}>{message.error?<strong>{message.error}</strong>:<><div><strong>{message.subject||'(no subject)'}</strong></div><div style={{fontSize:13,color:'#6b7280'}}>{message.sender||'Unknown sender'}</div><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',lineHeight:1.45}}>{message.body||'(no text body)'}</pre>{message.attachments?.length>0&&<div style={{fontSize:12,color:'#6b7280'}}>Attachments: {message.attachments.map((a:any)=>a.filename||a.mimeType).join(', ')}</div>}</>}</div>}</div>;
}
