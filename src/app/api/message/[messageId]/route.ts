import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../auth/auth.ts';
import { assertOperationalAccount } from '../../../../auth/google-account.ts';
import { createRuntimeApp } from '../../../../services/runtime-app.ts';
import { TriageService } from '../../../../services/triage-service.ts';

export async function GET(_request:Request,{params}:{params:Promise<{messageId:string}>}){
  try{
    const session=await getServerSession(authOptions);if(!session?.user?.email)return NextResponse.json({error:'unauthorized'},{status:401});
    const app=createRuntimeApp();const installation=app.repos.installation.get();if(!installation)throw new Error('installation missing');assertOperationalAccount(installation,session.user.email);
    const {messageId}=await params;const message=await new TriageService({gmail:app.gmail,repos:app.repos}).getLiveMessage(messageId);
    return NextResponse.json({messageId:message.id,sender:message.sender,recipients:message.recipients,subject:message.subject,body:message.body,timestampMs:message.timestampMs,attachments:message.attachments});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'message fetch failed'},{status:400});}
}
