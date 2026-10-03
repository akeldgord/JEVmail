'use client';

import { useActionState,useState } from 'react';
import { saveClassifierAction,type ClassifierActionState } from '../../app/dashboard/classifier/actions.ts';
import { MAX_GLOBAL_INSTRUCTIONS_CHARS } from '../../classifier/prompt-builder.ts';

const INITIAL:ClassifierActionState={ok:true};

export function ClassifierSettingsForm({model,instructions,hash}:{model:string;instructions:string;hash:string}){
  const [state,action,pending]=useActionState(saveClassifierAction,INITIAL);
  const [text,setText]=useState(instructions);
  const over=text.length>MAX_GLOBAL_INSTRUCTIONS_CHARS;
  return <form action={action} style={{background:'white',padding:16,border:'1px solid #e5e7eb',borderRadius:12,display:'grid',gap:10,marginBottom:16}}>
    <label>Pinned model <input name="model" defaultValue={model} style={{marginLeft:8}}/></label>
    <label>Global handling instructions<textarea name="globalInstructions" value={text} onChange={e=>setText(e.target.value)} rows={7} style={{display:'block',width:'100%',boxSizing:'border-box',marginTop:6,padding:10}}/></label>
    <div style={{fontSize:12,color:over?'#b91c1c':'#6b7280'}}>{text.length.toLocaleString()} / {MAX_GLOBAL_INSTRUCTIONS_CHARS.toLocaleString()} chars{over?' · shorten before saving':''}</div>
    {state.error?<div role="alert" style={{color:'#b91c1c',fontSize:13}}>{state.error}</div>:null}
    <div style={{fontSize:12,color:'#6b7280'}}>Active config: <code>{hash}</code></div>
    <button disabled={pending} style={{width:'fit-content'}}>{pending?'Saving...':'Save as new config version'}</button>
  </form>;
}
