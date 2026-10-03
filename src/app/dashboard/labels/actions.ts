'use server';
import { revalidatePath } from 'next/cache';
import { requireOperationalApp } from '../../../auth/dashboard-auth.ts';
import { addLabelWithApp,deleteLabelWithApp,saveLabelWithApp } from '../../../services/classifier-config-editor.ts';

export async function saveLabelAction(formData:FormData){const app=await requireOperationalApp();await saveLabelWithApp(app,formData);revalidatePath('/dashboard/labels');revalidatePath('/dashboard/classifier');}
export async function addLabelAction(formData:FormData){const app=await requireOperationalApp();await addLabelWithApp(app,formData);revalidatePath('/dashboard/labels');revalidatePath('/dashboard/classifier');}
export async function deleteLabelAction(formData:FormData){const app=await requireOperationalApp();await deleteLabelWithApp(app,formData);revalidatePath('/dashboard/labels');revalidatePath('/dashboard/classifier');}
