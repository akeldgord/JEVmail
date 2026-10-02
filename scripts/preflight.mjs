import { requireEnv } from '../src/config/env.ts';

const env=requireEnv();
const redirect=new URL('/api/auth/callback/google',env.APP_URL).toString();
console.log('JEVmail preflight');
console.log(`Google OAuth redirect URI: ${redirect}`);

if(env.JEV_BASE_URL.includes('jevmodel.org')){
  throw new Error('JEV_BASE_URL points to jevmodel.org. Use the official TypeSafe API: https://api.typesafe.ai');
}

const body={
  model:env.JEV_MODEL,
  state:'JEVmail installation preflight. No email content is included.',
  questions:{
    preflight:{
      type:'choice',
      instructions:'Choose ok. This request verifies that the configured classifier endpoint, API key, and model are accepted.',
      criteria:{
        ok:'The preflight request is valid.',
        invalid:'The preflight request is invalid.'
      }
    }
  }
};

let response;
try{
  response=await fetch(`${env.JEV_BASE_URL.replace(/\/$/,'')}/v1/systemone`,{
    method:'POST',
    headers:{
      Authorization:`Bearer ${env.JEVMODEL_API_KEY}`,
      'Content-Type':'application/json',
      'Idempotency-Key':'jevmail-install-preflight-v1'
    },
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(20000)
  });
}catch(error){
  throw new Error(`Classifier preflight could not reach ${env.JEV_BASE_URL}: ${error instanceof Error?error.message:String(error)}`);
}

const payload=await response.json().catch(()=>({}));
if(!response.ok){
  const message=payload?.error?.message??payload?.message??`HTTP ${response.status}`;
  throw new Error(`Classifier preflight failed (HTTP ${response.status}): ${message}`);
}

console.log(`Classifier: OK (${env.JEV_MODEL} at ${env.JEV_BASE_URL})`);
console.log('Environment: OK');
console.log('Next: start JEVmail, sign in with Google, and grant Gmail access.');
console.log('JEVmail verifies gmail.modify after OAuth consent.');
