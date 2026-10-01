import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/auth.ts';
import { assertBoundAccount } from '../../../auth/google-account.ts';
import { createRuntimeApp } from '../../../services/runtime-app.ts';
import type { BacklogRange } from '../../../processing/backlog.ts';

async function authorizedApp(){const session=await getServerSession(authOptions);if(!session?.user?.email)return null;const app=createRuntimeApp();const installation=app.repos.installation.get();if(!installation)return null;assertBoundAccount(installation.accountEmail,session.user.email);return app;}

export async function POST(request:Request){
  try{
    const app=await authorizedApp();if(!app)return NextResponse.json({error:'unauthorized'},{status:401});
    const body=await request.json();const action=String(body.action??'');
    if(action==='estimate')return NextResponse.json(await app.backlog.estimateBacklog(body.range as BacklogRange));
    if(action==='start')return NextResponse.json(await app.backlog.createBacklogJob(body.range as BacklogRange));
    const jobId=Number(body.jobId);if(!Number.isInteger(jobId)||jobId<1)return NextResponse.json({error:'invalid jobId'},{status:400});
    if(action==='pause')return NextResponse.json(app.backlog.pauseBacklog(jobId));
    if(action==='resume')return NextResponse.json(app.backlog.resumeBacklog(jobId));
    if(action==='cancel')return NextResponse.json(app.backlog.cancelBacklog(jobId));
    if(action==='run_batch')return NextResponse.json(await app.backlog.runBacklogBatch(jobId));
    return NextResponse.json({error:'unknown action'},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'backlog error'},{status:400});}
}
