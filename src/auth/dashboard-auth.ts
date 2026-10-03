import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './auth.ts';
import { dashboardAccessState,assertOperationalAccount } from './google-account.ts';
import { getRuntimeRepositories } from '../db/runtime.ts';
import { createRuntimeApp } from '../services/runtime-app.ts';
import { ensureInstallationSetup,mergeDefaultTaxonomy } from '../services/setup-service.ts';

let defaultsChecked=false;

export async function requireDashboardContext(){
  const session=await getServerSession(authOptions);const email=session?.user?.email;
  if(!email)redirect('/signin');
  let installation=getRuntimeRepositories().installation.get();
  let state=dashboardAccessState(email,installation);
  if(state==='connected'&&(!installation?.processedLabelId||!getRuntimeRepositories().config.getActive())){
    const app=createRuntimeApp();await ensureInstallationSetup({email,gmail:app.gmail,repos:app.repos,model:app.env.JEV_MODEL});installation=app.repos.installation.get();state=dashboardAccessState(email,installation);
  }
  if(state==='connected'&&!defaultsChecked){const app=createRuntimeApp();const merge=await mergeDefaultTaxonomy({gmail:app.gmail,repos:app.repos});defaultsChecked=merge.pending.length===0;installation=app.repos.installation.get();}
  return{session,email,installation,state};
}
export async function requireOperationalApp(){const ctx=await requireDashboardContext();if(ctx.state!=='connected')throw new Error(ctx.state==='needs_reconnect'?'Gmail authorization requires reconnect.':'Google account mismatch.');const app=createRuntimeApp();const installation=app.repos.installation.get();if(!installation)throw new Error('installation missing');assertOperationalAccount(installation,ctx.email);return app;}
