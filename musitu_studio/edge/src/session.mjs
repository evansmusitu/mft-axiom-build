/** Access-bound, HTTP-only admin session. Not an alternate public authentication path.
 * The Worker verifies the upstream signed Cloudflare Access JWT before issuing or
 * accepting this session; its HMAC key is the separate Studio admin secret.
 */
const NAME='musitu_staff_session',TTL=3600;
const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decode(value){
  if(!/^[A-Za-z0-9_-]{12,1500}$/.test(value))return null;
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0)))}catch{return null}
}
async function digest(message){
  const b=new TextEncoder().encode(message);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function sign(data,secret){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))))
    .map(x=>x.toString(16).padStart(2,'0')).join('');
}
function ready(env){
  return env.STUDIO_SESSION_ENABLED==='true'&&env.STUDIO_LOCAL_TEST_ONLY!=='true'&&
    typeof env.STUDIO_ADMIN_TOKEN==='string'&&env.STUDIO_ADMIN_TOKEN.length>=32;
}
export async function issueStaffCookie(request,env){
  if(!ready(env))return null;
  const jwt=request.headers.get('cf-access-jwt-assertion');
  if(!jwt||jwt.length<100||jwt.length>8192)return null;
  const record={v:1,iat:Math.floor(Date.now()/1000),j:await digest(jwt),nonce:crypto.randomUUID()};
  const encoded=encode(JSON.stringify(record));
  const signature=await sign(encoded,env.STUDIO_ADMIN_TOKEN);
  return NAME+'='+encoded+'.'+signature+'; Path=/api; Max-Age='+TTL+'; Secure; HttpOnly; SameSite=Strict';
}
export async function verifyStaffCookie(request,env){
  if(!ready(env))return false;
  const jwt=request.headers.get('cf-access-jwt-assertion');
  if(!jwt||jwt.length<100||jwt.length>8192)return false;
  const cookies=request.headers.get('cookie')||'';
  if(cookies.length>6000)return false;
  const cookie=cookies.split(';').map(v=>v.trim()).find(v=>v.startsWith(NAME+'='));
  if(!cookie)return false;
  const contents=cookie.slice(NAME.length+1);
  const m=/^([A-Za-z0-9_-]{12,1500})\.([0-9a-f]{64})$/.exec(contents);
  if(!m)return false;
  const raw=decode(m[1]);if(!raw)return false;
  let obj;try{obj=JSON.parse(raw)}catch{return false}
  const t=Math.floor(Date.now()/1000);
  if(obj?.v!==1||!Number.isInteger(obj.iat)||obj.iat>t+5||obj.iat+TTL<=t||
      typeof obj.j!=='string'||!(/^[0-9a-f]{64}$/).test(obj.j)||
      typeof obj.nonce!=='string'||obj.nonce.length>100)return false;
  const hash=await digest(jwt);
  if(hash!==obj.j)return false;
  const expected=await sign(m[1],env.STUDIO_ADMIN_TOKEN);
  // Fixed-length digests. A wrong HMAC can never authorize.
  let xor=0;for(let i=0;i<64;i++)xor|=expected.charCodeAt(i)^m[2].charCodeAt(i);
  return xor===0;
}
