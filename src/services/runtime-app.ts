import { requireEnv } from '../config/env.ts';
import { getRuntimeRepositories } from '../db/runtime.ts';
import { decryptSecret } from '../auth/token-crypto.ts';
import { createGoogleGmailClient } from '../gmail/gmail-client.ts';
import { JevClient } from '../classifier/jev-client.ts';
import { JevClassifier } from '../classifier/jev-classifier.ts';
import { RateGovernor } from '../processing/limiter.ts';
import { MessageProcessor } from '../processing/processor.ts';
import { BacklogManager } from '../processing/backlog.ts';

export function createRuntimeApp(){
  const env=requireEnv(); const repos=getRuntimeRepositories(); const installation=repos.installation.get();
  if(!installation?.encryptedRefreshToken)throw new Error('Gmail connection required');
  const gmail=createGoogleGmailClient({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,redirectUri:`${env.APP_URL}/api/auth/callback/google`,refreshToken:decryptSecret(installation.encryptedRefreshToken,env.APP_ENCRYPTION_KEY)});
  const classifier=new JevClassifier(new JevClient({baseUrl:env.JEV_BASE_URL,apiKey:env.JEVMODEL_API_KEY}));
  const governor=new RateGovernor(repos.usage,()=>{const i=repos.installation.get();if(!i)throw new Error('installation missing');return{maxPerMinute:i.maxPerMinute,maxPerHour:i.maxPerHour,maxPerDay:i.maxPerDay,dailySpendCents:i.dailySpendCents??undefined};});
  const processor=new MessageProcessor({gmail,classifier,repos,governor});
  const backlog=new BacklogManager({gmail,repos,processor,concurrency:env.BACKLOG_CONCURRENCY});
  return{env,repos,gmail,classifier,governor,processor,backlog};
}
