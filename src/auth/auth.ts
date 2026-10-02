import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { requireEnv } from '../config/env.ts';
import { getRuntimeRepositories } from '../db/runtime.ts';
import { assertBoundAccount } from './google-account.ts';
import { encryptSecret } from './token-crypto.ts';
import { evaluateGrantedScopes, GMAIL_MODIFY_SCOPE } from './oauth-scope.ts';

const env=requireEnv();

export const authOptions:NextAuthOptions={
  secret:env.AUTH_SECRET,
  providers:[GoogleProvider({
    clientId:env.GOOGLE_CLIENT_ID,
    clientSecret:env.GOOGLE_CLIENT_SECRET,
    authorization:{params:{scope:`openid email profile ${GMAIL_MODIFY_SCOPE}`,access_type:'offline',prompt:'consent'}}
  })],
  pages:{signIn:'/signin'},
  session:{strategy:'jwt'},
  callbacks:{
    async signIn({user}){
      if(!user.email)return false;
      const i=getRuntimeRepositories().installation.get();
      if(i)try{assertBoundAccount(i.accountEmail,user.email);}catch{return false;}
      return true;
    },
    async jwt({token,account,profile}){
      const email=(profile as any)?.email??token.email;
      if(account&&email){
        const repos=getRuntimeRepositories();
        const i=repos.installation.get();
        if(i)assertBoundAccount(i.accountEmail,String(email));
        const {gmailScopePresent,reconnectReason}=evaluateGrantedScopes((account as any).scope);
        const encryptedRefreshToken=gmailScopePresent&&account.refresh_token
          ?encryptSecret(account.refresh_token,env.APP_ENCRYPTION_KEY)
          :i?.encryptedRefreshToken??null;
        const connectionReady=gmailScopePresent&&Boolean(encryptedRefreshToken);
        const finalReconnectReason=!gmailScopePresent
          ?reconnectReason
          :connectionReady?null:'Google did not return offline Gmail access. Re-authorize JEVmail and grant access again.';
        repos.installation.upsert({
          accountEmail:String(email),
          encryptedRefreshToken,
          startupWatermarkMs:i?.startupWatermarkMs??Date.now(),
          processedLabelId:i?.processedLabelId??null,
          paused:i?.paused??false,
          needsReconnect:!connectionReady
        });
        repos.installation.patch?.({reconnectReason:finalReconnectReason});
        if(!gmailScopePresent){
          repos.error.add({
            stage:'oauth',category:'gmail_scope',provider:'gmail',status:null,
            detail:'Google authorization is missing gmail.modify. Re-authorize JEVmail and grant Gmail access.',
            messageId:null,createdAt:Date.now()
          });
        }
      }
      return token;
    },
    async session({session}){
      const i=getRuntimeRepositories().installation.get();
      if(session.user?.email&&i)assertBoundAccount(i.accountEmail,session.user.email);
      return session;
    }
  }
};
