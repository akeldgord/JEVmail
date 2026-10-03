'use server';
import { revalidatePath } from 'next/cache';
import { requireOperationalApp } from '../../../auth/dashboard-auth.ts';
import { saveClassifierWithApp } from '../../../services/classifier-config-editor.ts';

export type ClassifierActionState={ok:boolean;error?:string};
export async function saveClassifierAction(_previous:ClassifierActionState,formData:FormData):Promise<ClassifierActionState>{
  try{const app=await requireOperationalApp();await saveClassifierWithApp(app,formData);revalidatePath('/dashboard/classifier');revalidatePath('/dashboard/labels');return{ok:true};}
  catch(error){return{ok:false,error:error instanceof Error?error.message:'Classifier update failed.'};}
}
