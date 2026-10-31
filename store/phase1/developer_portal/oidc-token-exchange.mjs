/**
 * MUSITU Store V2 PRIVATE OIDC token transport; NOT DEPLOYED.
 * Trusted backend only. Exact issuer-origin HTTPS token endpoint, fixed client
 * registration, no redirects, bounded response and no applicant-selected URL.
 * A synthetic requestImpl is permitted ONLY in CI for isolated tests.
 */
import https from 'node:https';
const deny=()=>new Error('oidc_exchange_denied');
function ok(condition){if(!condition)throw deny();}
function safeUrl(raw){
 ok(typeof raw==='string'&&raw.length<=512);
 let url;try{url=new URL(raw);}catch{throw deny();}
 ok(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&!url.search&&
    (url.href===raw||url.origin===raw));
 return url;
}
function privatePost({url,method,headers,body,timeoutMs,maxBytes}){
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,result)=>{if(done)return;done=true;error?reject(error):resolve(result);};
  const req=https.request(url,{method,headers,agent:false,timeout:timeoutMs},res=>{
   let size=0;const chunks=[];
   res.on('data',piece=>{
    size+=piece.length;
    if(size>maxBytes){finish(deny());req.destroy();return;}
    chunks.push(piece);
   });
   res.on('end',()=>finish(null,{statusCode:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
   res.on('error',()=>finish(deny()));
  });
  req.on('timeout',()=>{finish(deny());req.destroy();});
  req.on('error',()=>finish(deny()));
  req.end(body);
 });
}
export function createPinnedOidcTokenExchanger({issuer,tokenEndpoint,clientId,redirectUri,
 clientSecret,requestImpl}={}){
 const i=safeUrl(issuer),t=safeUrl(tokenEndpoint),r=safeUrl(redirectUri);
 ok(t.origin===i.origin&&typeof clientId==='string'&&/^[A-Za-z0-9:_-]{6,128}$/.test(clientId)&&
    (clientSecret===undefined||typeof clientSecret==='string'&&clientSecret.length>=24&&clientSecret.length<=512));
 // This seam cannot be used to inject arbitrary network behavior at runtime.
 ok(requestImpl===undefined||(process.env.CI==='true'&&typeof requestImpl==='function'));
 const request=requestImpl||privatePost;
 return async function exchangeCode(args){
  try{
   ok(args&&args.tokenEndpoint===tokenEndpoint&&args.clientId===clientId&&args.redirectUri===redirectUri&&
     typeof args.code==='string'&&/^[A-Za-z0-9._~-]{8,1024}$/.test(args.code)&&
     typeof args.verifier==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(args.verifier));
   const form=new URLSearchParams({grant_type:'authorization_code',code:args.code,
     code_verifier:args.verifier,redirect_uri:redirectUri,client_id:clientId});
   const body=Buffer.from(form.toString());
   const headers={'content-type':'application/x-www-form-urlencoded',accept:'application/json',
     'content-length':String(body.length)};
   // Confidential client authentication is configured exclusively by the
   // trusted operator. Never place clientSecret in URL, logs or test evidence.
   if(clientSecret!==undefined)headers.authorization='Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64');
   const response=await request({url:tokenEndpoint,method:'POST',headers,body,timeoutMs:8000,maxBytes:12288});
   ok(response&&response.statusCode===200&&Buffer.isBuffer(response.body)&&
     response.body.length>0&&response.body.length<=12288&&
     typeof response.headers?.['content-type']==='string'&&
     response.headers['content-type'].split(';',1)[0].trim().toLowerCase()==='application/json');
   let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response.body));}catch{throw deny();}
   ok(parsed!==null&&!Array.isArray(parsed)&&typeof parsed==='object'&&
     typeof parsed.id_token==='string'&&parsed.id_token.length>=16&&parsed.id_token.length<=8192);
   return {id_token:parsed.id_token};
  }catch{throw deny();}
 };
}
