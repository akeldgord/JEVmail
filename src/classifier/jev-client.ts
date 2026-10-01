export class JevApiError extends Error{
  status:number; transient:boolean;
  constructor(message:string,status:number,transient:boolean){super(message);this.name='JevApiError';this.status=status;this.transient=transient;}
}
export type JevRequest={model:string;state:string;questions:Record<string,{type:'choice';instructions:string;criteria:Record<string,string>}>};
export type JevResponse={model:string;answers:Record<string,{type:string;choice?:string;probabilities?:Record<string,number>;confidence?:number}>;usage?:{input_tokens?:number;output_tokens?:number}};
export class JevClient{
  private opts:{baseUrl:string;apiKey:string;transport?:typeof fetch};
  constructor(opts:{baseUrl:string;apiKey:string;transport?:typeof fetch}){this.opts=opts;}
  async evaluate(body:JevRequest,idempotencyKey:string):Promise<JevResponse>{
    const transport=this.opts.transport??fetch; let response:Response;
    try{response=await transport(`${this.opts.baseUrl.replace(/\/$/,'')}/v1/systemone`,{method:'POST',headers:{Authorization:`Bearer ${this.opts.apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}
    catch(e:any){throw new JevApiError(e?.message??'Jev network error',0,true);}
    const payload:any=await response.json().catch(()=>({}));
    if(!response.ok){const transient=response.status===429||response.status>=500; throw new JevApiError(payload?.error?.message??`Jev HTTP ${response.status}`,response.status,transient);}
    return payload as JevResponse;
  }
}
