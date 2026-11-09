/** Pure WebCrypto HMAC wire contract for isolated owner-only service binding. */
const enc=new TextEncoder();
export const HMAC_VERSION='lifeline.cf_service.v1';
export const hex=buffer=>Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
export const safeEqual=(a,b)=>{
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let delta=0;for(let i=0;i<a.length;i++)delta|=a.charCodeAt(i)^b.charCodeAt(i);
  return delta===0;
};
export async function serviceHmac(key,path,stamp,nonce,tenant,body){
  if(typeof key!=='string'||key.length<32||key.length>512)throw Error('invalid_stage_key');
  const hash=hex(await crypto.subtle.digest('SHA-256',enc.encode(body)));
  const parts=[HMAC_VERSION,'POST',path,stamp,nonce,tenant,hash].join('\n');
  const cryptoKey=await crypto.subtle.importKey('raw',enc.encode(key),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',cryptoKey,enc.encode(parts)));
}
export const json=(object,status=200)=>new Response(JSON.stringify(object),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}
});
