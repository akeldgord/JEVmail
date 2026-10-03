'use client';

import { useActionState,useState } from 'react';
import type { ClassificationLabel,ClassificationTaxonomy } from '../../domain/taxonomy.ts';
import { DEFAULT_TAXONOMY } from '../../domain/defaults.ts';
import { CRITERIA_BUDGET_CHARS } from '../../classifier/prompt-builder.ts';
import { addLabelAction,deleteLabelAction,saveLabelAction,type ConfigActionState } from '../../app/dashboard/labels/actions.ts';

const DEFAULT_IDS=new Set(DEFAULT_TAXONOMY.labels.map(label=>label.id));
const INITIAL:ConfigActionState={ok:true};

function slugify(value:string){return value.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');}
function ActionError({state}:{state:ConfigActionState}){return state.error?<div role="alert" style={{color:'#b91c1c',fontSize:13}}>{state.error}</div>:null;}

function AddCategoryForm({gmailLabels,budget}:{gmailLabels:{id:string;name:string}[];budget:{criteriaJsonChars:number;enabledLabelCount:number}}){
  const [state,action,pending]=useActionState(addLabelAction,INITIAL);
  const [newName,setNewName]=useState('');
  const [newId,setNewId]=useState('');
  const [idTouched,setIdTouched]=useState(false);
  return <form action={action} style={{background:'#f8fafc',padding:16,border:'1px solid #cbd5e1',borderRadius:12,display:'grid',gap:8}}>
    <h2 style={{margin:0}}>Add category</h2>
    <div style={{fontSize:12,color:'#64748b'}}>Prompt budget: {budget.criteriaJsonChars.toLocaleString()} / {CRITERIA_BUDGET_CHARS.toLocaleString()} chars · {budget.enabledLabelCount} labels</div>
    <label>Display name<input name="displayName" value={newName} onChange={e=>{const value=e.target.value;setNewName(value);if(!idTouched)setNewId(slugify(value));}} required style={{display:'block',width:'100%',boxSizing:'border-box',padding:8}}/></label>
    <label>Category id<input name="id" value={newId} onChange={e=>{setIdTouched(true);setNewId(e.target.value);}} pattern="[a-z0-9_]+" required style={{display:'block',width:'100%',boxSizing:'border-box',padding:8}}/><span style={{fontSize:12,color:'#64748b'}}>Lowercase letters, numbers, underscores. Editable before save.</span></label>
    <label>Description<input name="description" style={{display:'block',width:'100%',boxSizing:'border-box',padding:8}}/></label>
    <label>Guidance<textarea name="guidance" rows={3} required style={{display:'block',width:'100%',boxSizing:'border-box',padding:8}}/></label>
    <label>Gmail label <select name="gmailLabelId" defaultValue="" style={{marginLeft:8}}><option value="">Auto-create JEVmail/&lt;display name&gt;</option>{gmailLabels.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    <ActionError state={state}/>
    <button type="submit" disabled={pending} style={{width:'fit-content'}}>{pending?'Adding...':'Add category'}</button>
  </form>;
}

function ExistingCategory({label,gmailLabels}:{label:ClassificationLabel;gmailLabels:{id:string;name:string}[]}){
  const [saveState,saveAction,savePending]=useActionState(saveLabelAction,INITIAL);
  const [deleteState,deleteAction,deletePending]=useActionState(deleteLabelAction,INITIAL);
  const protectedRole=['reply_needed','action_needed','indeterminate'].includes(label.semanticRole);
  const deletable=!protectedRole&&!DEFAULT_IDS.has(label.id);
  return <div style={{background:'white',padding:16,border:'1px solid #e5e7eb',borderRadius:12}}>
    <form action={saveAction} style={{display:'grid',gap:8}}>
      <input type="hidden" name="labelId" value={label.id}/>
      <div style={{display:'flex',justifyContent:'space-between',gap:12}}><input name="displayName" defaultValue={label.displayName} style={{fontWeight:700,fontSize:16,padding:8,flex:1}}/><label><input type="checkbox" name="enabled" defaultChecked={label.enabled} disabled={protectedRole}/> Enabled</label></div>
      <textarea name="guidance" defaultValue={label.guidance} rows={2} style={{padding:8}}/>
      <label style={{fontSize:13}}>Gmail label <select name="gmailLabelId" defaultValue={label.gmailLabelId} style={{marginLeft:8}}>{gmailLabels.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <div style={{fontSize:12,color:'#6b7280'}}>Role: {label.semanticRole} · Priority {label.priority}{protectedRole?' · protected':''}</div>
      <ActionError state={saveState}/>
      <button type="submit" disabled={savePending} style={{width:'fit-content'}}>{savePending?'Saving...':'Save label'}</button>
    </form>
    {deletable?<form action={deleteAction} style={{marginTop:8}}>
      <input type="hidden" name="labelId" value={label.id}/>
      <ActionError state={deleteState}/>
      <button type="submit" disabled={deletePending}>{deletePending?'Deleting...':'Delete category'}</button>
      {label.enabled?<span style={{fontSize:12,color:'#64748b',marginLeft:8}}>Disable first.</span>:null}
    </form>:null}
  </div>;
}

export function TaxonomyEditor({taxonomy,gmailLabels,budget}:{taxonomy:ClassificationTaxonomy;gmailLabels:{id:string;name:string}[];budget:{criteriaJsonChars:number;enabledLabelCount:number}}){
  return <div style={{display:'grid',gap:12}}>
    <AddCategoryForm gmailLabels={gmailLabels} budget={budget}/>
    {taxonomy.labels.map(label=><ExistingCategory key={label.id} label={label} gmailLabels={gmailLabels}/>)}
  </div>;
}
