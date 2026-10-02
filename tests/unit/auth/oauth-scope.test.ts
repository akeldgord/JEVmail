import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGrantedScopes, GMAIL_MODIFY_SCOPE } from '../../../src/auth/oauth-scope.ts';

test('OAuth scope evaluation accepts gmail.modify',()=>{
  const result=evaluateGrantedScopes(`openid email profile ${GMAIL_MODIFY_SCOPE}`);
  assert.equal(result.gmailScopePresent,true);
  assert.equal(result.reconnectReason,null);
});

test('OAuth scope evaluation flags withheld Gmail permission with actionable reason',()=>{
  const result=evaluateGrantedScopes('openid email profile');
  assert.equal(result.gmailScopePresent,false);
  assert.match(result.reconnectReason??'',/Gmail permission missing/i);
  assert.match(result.reconnectReason??'',/re-authorize/i);
});
