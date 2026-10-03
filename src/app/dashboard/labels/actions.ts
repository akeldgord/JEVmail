'use server';
import { revalidatePath } from 'next/cache';
import { requireOperationalApp } from '../../../auth/dashboard-auth.ts';
import { addLabelWithApp,deleteLabelWithApp,saveLabelWithApp } from '../../../services/classifier-config-editor.ts';

export type ConfigActionState={ok:boolean;error?:string};
function failure(error:unknown):ConfigActionState{return{ok:false,error:error instanceof Error?error.message:'Configuration update failed.'};}

export async function saveLabelAction(_previous:ConfigActionState,formData:FormData):Promise<ConfigActionState>{
  try{const app=await requireOperationalApp();await saveLabelWithApp(app,formData);revalidatePath('/dashboard/labels');revalidatePath('/dashboard/classifier');return{ok:true};}
  catch(error){return failure(error);}
}
export async function addLabelAction(_previous:ConfigActionState,formData:FormData):Promise<ConfigActionState>{
  try{const app=await requireOperationalApp();await addLabelWithApp(app,formData);revalidatePath('/dashboard/labels');revalidatePath('/dashboard/classifier');return{ok:true};}
  catch(error){return failure(error);}
}
export async function deleteLabelAction(_previous:ConfigActionState,formData:FormData):Promise<ConfigActionState>{
  try{const app=await requireOperationalApp();await deleteLabelWithApp(app,formData);revalidatePath('/dashboard/labels');revalidatePath('/dashboard/classifier');return{ok:true};}
  catch(error){return failure(error);}
}
