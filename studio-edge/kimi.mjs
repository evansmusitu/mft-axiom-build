const ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';
const MODEL = 'kimi-k2.6';
export class KimiIntegrationError extends Error {
  constructor(code,message,status=503) { super(message);this.name='KimiIntegrationError';this.code=code;this.status=status; }
}
export function kimiEnabled(env) {
  // Explicit opt-in is required to protect against accidental paid requests.
  return env.KIMI_ENABLED === 'true' && typeof env.KIMI_API_KEY === 'string' && env.KIMI_API_KEY.length >= 20;
}
export async function invokeKimi({ prompt, history=[], system }, env, fetcher=fetch) {
  if(!kimiEnabled(env)) {
    throw new KimiIntegrationError('KIMI_NOT_CONNECTED','Kimi requires a secure provider API key and explicit billing approval. No paid request was made.');
  }
  if(typeof prompt!=='string' || prompt.length<10 || prompt.length>900) {
    throw new KimiIntegrationError('KIMI_INVALID_PROMPT','Enter a question between 10 and 900 characters.',400);
  }
  const prior=history.filter(x=>x && ['user','assistant'].includes(x.role) &&
    typeof x.content==='string' && x.content.length<=950).slice(-4);
  let response;
  try {
    response=await fetcher(ENDPOINT,{
      method:'POST',
      headers:{
        authorization:'Bearer '+env.KIMI_API_KEY,
        'content-type':'application/json'
      },
      body:JSON.stringify({
        model:MODEL,temperature:0.5,max_tokens:750,
        messages:[{role:'system',content:system},...prior,{role:'user',content:prompt}]
      }),
      signal:AbortSignal.timeout(60000)
    });
  } catch {
    throw new KimiIntegrationError('KIMI_PROVIDER_UNAVAILABLE','Kimi could not be reached; please retry.');
  }
  if(!response.ok) {
    throw new KimiIntegrationError('KIMI_PROVIDER_UNAVAILABLE','Kimi is currently unavailable or its authorized credits are exhausted.',response.status===429?429:503);
  }
  let answer;
  try {answer=await response.json();}
  catch {throw new KimiIntegrationError('KIMI_BAD_RESPONSE','Kimi returned an unexpected response.');}
  const reply=answer?.choices?.[0]?.message?.content;
  if(typeof reply!=='string' || !reply.trim()) {
    throw new KimiIntegrationError('KIMI_EMPTY_RESPONSE','Kimi did not return a usable answer.');
  }
  return { reply:reply.trim().slice(0,6000),model:MODEL,mode:'kimi',liveSearch:false,
    generatedAt:new Date().toISOString(),
    note:'Kimi model output. No web browsing was performed automatically.' };
}
