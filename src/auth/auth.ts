import type { NextAuthOptions } from 'next-auth'; import GoogleProvider from 'next-auth/providers/google'; import { requireEnv } from '../config/env.ts'; import { getRuntimeRepositories } from '../db/runtime.ts'; import { assertBoundAccount } from './google-account.ts'; import { encryptSecret } from './token-crypto.ts';
const env=requireEnv();
export const authOptions:NextAuthOptions={
 secret:env.AUTH_SECRET,
 providers:[GoogleProvider({clientId:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,authorization:{params:{scope:'openid email profile https://www.googleapis.com/auth/gmail.modify',access_type:'offline',prompt:'consent'}}})],
 pages:{signIn:'/signin'}, session:{strategy:'jwt'},
 callbacks:{
  async signIn({user}){if(!user.email)return false; const i=getRuntimeRepositories().installation.get(); if(i)try{assertBoundAccount(i.accountEmail,user.email);}catch{return false;} return true;},
  async jwt({token,account,profile}){const email=(profile as any)?.email??token.email; if(account?.refresh_token&&email){const repos=getRuntimeRepositories(); const i=repos.installation.get(); if(i)assertBoundAccount(i.accountEmail,String(email)); repos.installation.upsert({accountEmail:String(email),encryptedRefreshToken:encryptSecret(account.refresh_token,env.APP_ENCRYPTION_KEY),startupWatermarkMs:i?.startupWatermarkMs??Date.now(),processedLabelId:i?.processedLabelId??null,paused:i?.paused??false,needsReconnect:false});} return token;},
  async session({session}){const i=getRuntimeRepositories().installation.get(); if(session.user?.email&&i)assertBoundAccount(i.accountEmail,session.user.email); return session;}
 }
};
