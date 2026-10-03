'use server';
import { revalidatePath } from 'next/cache';
import { requireOperationalApp } from '../../../auth/dashboard-auth.ts';
import { saveClassifierWithApp } from '../../../services/classifier-config-editor.ts';

export async function saveClassifierAction(formData:FormData){const app=await requireOperationalApp();await saveClassifierWithApp(app,formData);revalidatePath('/dashboard/classifier');revalidatePath('/dashboard/labels');}
