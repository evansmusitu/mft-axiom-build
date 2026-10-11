/** One-time Cloudflare *private staging* proof. The caller must use a local
 * HTTP loopback to a remote service binding, never a publicly deployed route.
 * Real Paynow settlement, merchant credentials, and sending are absent.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const err=()=>{throw Error('MMF_PRIVATE_REMOTE_QUALIFICATION_DENIED')};
const order=/^MMF-[A-Z0-9]{10,56}$/;
const needed=(data,keys)=>data&&typeof data==='object'&&keys.every(k=>Object.hasOwn(data,k));
const timeout=ms=>AbortSignal.timeout(ms);
export async function qualifyPrivateRemoteOrder({origin,operatorToken,orderReference,fetchFn=fetch}={}){
 if(!['http://127.0.0.1:8789','http://localhost:8789'].includes(origin)||
  typeof operatorToken!=='string'||operatorToken.length<32||operatorToken.length>300||
  !order.test(orderReference)||typeof fetchFn!=='function')err();
 const req=async(method,path,body,token=operatorToken)=>{
  const options={method,headers:{authorization:`Bearer ${token}`},signal:timeout(15000)};
  if(body!==undefined){options.headers['content-type']='application/json';options.body=JSON.stringify(body)}
  const r=await fetchFn(origin+path,options);let data;try{data=await r.json()}catch{err()}
  if(!data||typeof data!=='object'||Array.isArray(data))err();
  return {status:r.status,data};
 };
 const path='/v1/billing/stage/orders',item=path+'/'+orderReference;
 const input={customerReference:'customer:cloud:stage:verified',contractReference:'contract:cloud:stage:verified',orderReference};
 const first=await req('POST',path,input);
 if(first.status!==201||!needed(first.data,['status','orderReference','idempotent','canAcceptCustomerFunds','grantsMailSending'])||
  first.data.orderReference!==orderReference||first.data.status!=='PENDING'||first.data.idempotent!==false||
  first.data.canAcceptCustomerFunds!==false||first.data.grantsMailSending!==false)err();
 const read=await req('GET',item);
 if(read.status!==200||read.data.status!=='PENDING'||read.data.orderReference!==orderReference||
  read.data.canAcceptCustomerFunds!==false||read.data.grantsMailSending!==false)err();
 const retry=await req('POST',path,input);
 if(retry.status!==200||retry.data.status!=='PENDING'||retry.data.idempotent!==true||retry.data.orderReference!==orderReference||
    retry.data.canAcceptCustomerFunds!==false||retry.data.grantsMailSending!==false)err();
 const unauthorized=await req('GET',item,undefined,'incorrect-scope-credential');
 if(unauthorized.status!==401||unauthorized.data.error!=='UNAUTHORIZED')err();
 const price=await req('POST',path,{...input,amountCents:0});
 if(price.status!==422||price.data.error!=='INVALID_ORDER_REQUEST')err();
 const missing=await req('GET',path+'/MMF-AAAAAAAAAAAAAAA999999999');
 if(missing.status!==404||missing.data.error!=='NOT_FOUND')err();
 return Object.freeze({gate:'MMF_PRIVATE_REMOTE_ORDER_STAGE',status:'PASS',orderCreated:true,readVerified:true,
  idempotentRetryVerified:true,unauthorizedDenied:true,clientPriceRejected:true,missingOrderDenied:true,
  customerFunds:false,customerEmail:false,providerSettlementVerified:false,publicRoutes:false,
  operatorSecretLogged:false,orderReferenceSha256StoredInArtifact:false});
}
if(import.meta.url===`file://${process.argv[1]}`){
 try{
  const file=process.env.MMF_OPERATOR_TOKEN_FILE;
  if(!file||!file.startsWith('/'))err();
  const token=readFileSync(file,'utf8').trim();
  const referenceFile=process.env.MMF_PRIVATE_REFERENCE_FILE;
  if(!referenceFile||!referenceFile.startsWith('/'))err();
  let proof;
  if(process.env.MMF_PRIVATE_VERIFY_PERSISTENCE==='1'){
   const ref=readFileSync(referenceFile,'utf8').trim();
   if(!order.test(ref))err();
   const r=await fetch('http://127.0.0.1:8789/v1/billing/stage/orders/'+ref,{headers:{authorization:'Bearer '+token},signal:timeout(15000)});
   const body=await r.json();
   if(r.status!==200||body.orderReference!==ref||body.status!=='PENDING'||body.canAcceptCustomerFunds!==false||body.grantsMailSending!==false)err();
   proof={gate:'MMF_PRIVATE_REMOTE_DURABLE_ORDER_PERSISTENCE',status:'PASS',persistedAcrossLocalBridgeRestart:true,customerFunds:false,customerEmail:false,publicRoutes:false};
  }else{
   const ref='MMF-PRIVATECLOUD'+randomBytes(12).toString('hex').toUpperCase();
   proof=await qualifyPrivateRemoteOrder({origin:'http://127.0.0.1:8789',operatorToken:token,orderReference:ref});
   writeFileSync(referenceFile,ref+'\n',{mode:0o600});
  }
  console.log(JSON.stringify(proof));
  const destination=process.env.MMF_CLOUD_QUALIFICATION_EVIDENCE;
  if(destination)writeFileSync(destination,JSON.stringify({...proof,verifiedAt:new Date().toISOString()})+'\n',{mode:0o600});
 }catch{console.error('MMF_PRIVATE_REMOTE_QUALIFICATION_FAILED');process.exitCode=1}
}
