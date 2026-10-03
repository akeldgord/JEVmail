const base=(process.env.JEV_BASE_URL||'https://api.typesafe.ai').replace(/\/$/,'');
const key=process.env.JEVMODEL_API_KEY;
const model=process.env.JEV_MODEL;
if(!key||!model){console.error('Set JEVMODEL_API_KEY and JEV_MODEL before running this probe.');process.exit(2);}

const sizes=[4000,8000,16000,32000];

function criteriaFor(target){
  const each=Math.max(1,Math.floor((target-80)/2));
  return{
    alpha:'A'.repeat(each),
    beta:'B'.repeat(each)
  };
}

async function probe(target){
  const body={
    model,
    state:'JEVmail prompt-size probe. Choose alpha.',
    questions:{
      handling:{
        type:'choice',
        instructions:`Synthetic JEVmail prompt-size probe at approximately ${target} criteria characters.`,
        criteria:criteriaFor(target)
      }
    }
  };
  const criteriaChars=JSON.stringify(body.questions.handling.criteria).length;
  const started=Date.now();
  let response;
  try{
    response=await fetch(`${base}/v1/systemone`,{
      method:'POST',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(30000)
    });
  }catch(error){
    return{target,criteriaChars,status:'network_error',ms:Date.now()-started,error:error instanceof Error?error.message:String(error)};
  }
  const text=await response.text();
  return{target,criteriaChars,status:response.status,ok:response.ok,ms:Date.now()-started,body:text.slice(0,1000)};
}

console.log(JSON.stringify({endpoint:base,model,sizes},null,2));
for(const size of sizes)console.log(JSON.stringify(await probe(size),null,2));
