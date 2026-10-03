'use client';

import { useState } from 'react';
import { saveClassifierAction } from '../../app/dashboard/classifier/actions.ts';
import { MAX_GLOBAL_INSTRUCTIONS_CHARS } from '../../classifier/prompt-builder.ts';

export function ClassifierSettingsForm({model,instructions,hash}:{model:string;instructions:string;hash:string}){
  const [text,setText]=useState(instructions);
  const over=text.length>MAX_GLOBAL_INSTRUCTIONS_CHARS;
  return <form action={saveClassifierAction} style={{background:'white',padding:16,border:'1px solid #e5e7eb',borderRadius:12,display:'grid',gap:10,marginBottom:16}}>
    <label>Pinned model <input name="model" defaultValue={model} style={{marginLeft:8}}/></label>
    <label>Global handling instructions<textarea name="globalInstructions" value={text} onChange={e=>setText(e.target.value)} rows={7} style={{display:'block',width:'100%',boxSizing:'border-box',marginTop:6,padding:10}}/></label>
    <div style={{fontSize:12,color:over?'#b91c1c':'#6b7280'}}>{text.length.toLocaleString()} / {MAX_GLOBAL_INSTRUCTIONS_CHARS.toLocaleString()} chars{over?' · shorten before saving':''}</div>
    <div style={{fontSize:12,color:'#6b7280'}}>Active config: <code>{hash}</code></div>
    <button style={{width:'fit-content'}}>Save as new config version</button>
  </form>;
}
