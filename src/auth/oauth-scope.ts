export const GMAIL_MODIFY_SCOPE='https://www.googleapis.com/auth/gmail.modify';

export function evaluateGrantedScopes(scope:string|null|undefined){
  const grantedScopes=String(scope??'').trim();
  const scopeWasReported=grantedScopes.length>0;
  const gmailScopePresent=!scopeWasReported||grantedScopes.split(/\s+/).includes(GMAIL_MODIFY_SCOPE);
  return{
    gmailScopePresent,
    reconnectReason:gmailScopePresent?null:'Gmail permission missing. Re-authorize JEVmail and grant Gmail access.'
  };
}
