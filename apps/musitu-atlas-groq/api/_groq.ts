export const models={fast:'llama-3.1-8b-instant',quality:'llama-3.3-70b-versatile'} as const;
type Message={role:'system'|'user'|'assistant';content:string};
export function respond(res:any,status:number,data:unknown){res.setHeader('Cache-Control','no-store');res.status(status).json(data);}
export function text(value:unknown,max:number){return typeof value==='string'?value.trim().slice(0,max):'';}
export function body(req:any):Record<string,unknown>{const raw=typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body;return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}
const quotas=new Map<string,{used:number;expires:number}>();
export function guard(req:any,res:any):boolean{
 if(req.method!=='POST'){respond(res,405,{error:'Method not allowed'});return false;}
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].slice(0,100);
 const now=Date.now(),rec=quotas.get(ip);
 if(rec&&rec.expires>now&&rec.used>=10){respond(res,429,{error:'Too many AI requests. Try again shortly.'});return false;}
 quotas.set(ip,{used:rec&&rec.expires>now?rec.used+1:1,expires:rec&&rec.expires>now?rec.expires:now+60000});
 if(quotas.size>1500)for(const [k,v] of quotas)if(v.expires<now)quotas.delete(k);
 return true;
}
export async function infer(messages:Message[],model:'fast'|'quality'='quality',json=false):Promise<string>{
 const secret=process.env.GROQ_API_KEY;
 if(!secret)throw Object.assign(new Error('Groq is not yet configured by the website administrator.'),{code:503});
 const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{
  method:'POST',
  headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},
  body:JSON.stringify({model:models[model],messages,temperature:json?0.2:0.55,
   max_completion_tokens:json?1600:1000,...(json?{response_format:{type:'json_object'}}:{})}),
  signal:AbortSignal.timeout(45000)
 });
 if(!response.ok){
  const code=response.status===429?429:503;
  const msg=response.status===429?'Groq model rate limit reached. Retry later.':
  response.status===401||response.status===403?'Groq key or model access is not authorized.':'The Groq model request could not be completed.';
  throw Object.assign(new Error(msg),{code});
 }
 const payload=await response.json();
 const value=payload?.choices?.[0]?.message?.content;
 if(typeof value!=='string'||!value.trim())throw Object.assign(new Error('The AI provider returned no text.'),{code:502});
 return value.trim();
}
export function fail(res:any,err:unknown){
 const e=err as {code?:number;message?:string};
 const code=typeof e.code==='number'&&[400,429,502,503].includes(e.code)?e.code:503;
 respond(res,code,{error:e.message||'AI provider temporarily unavailable.'});
}