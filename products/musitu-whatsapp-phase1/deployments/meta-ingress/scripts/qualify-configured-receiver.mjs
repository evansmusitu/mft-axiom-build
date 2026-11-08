import {randomUUID,createHash} from 'node:crypto';
const target=new URL(process.argv[2]||'https://invalid.invalid');
if(target.protocol!=='https:'||!/^musitu-whatsapp-meta-receiver-20261015-[a-z0-9]+-evansmusitu\.vercel\.app$/.test(target.hostname)||target.pathname!=='/'||target.search||target.username||target.password||target.port)throw Error('ISOLATED_HTTP_TARGET_REQUIRED');
const token=process.env.META_VERIFY_TOKEN;
if(typeof token!=='string'||token.length<32||token.length>256)throw Error('META_VERIFY_TOKEN_REQUIRED');
const rows=[];
async function probe(name,value,extra,status){
 const challenge=randomUUID().replaceAll('-','');
 const url=new URL('/api/meta/webhook',target);
 url.searchParams.set('hub.mode','subscribe');url.searchParams.set('hub.verify_token',value);url.searchParams.set('hub.challenge',challenge);
 if(extra==='metadata')for(let i=0;i<3;i++)url.searchParams.set('optional'+i,'1');
 if(extra==='duplicate')url.searchParams.append('hub.challenge','duplicate');
 if(extra==='excessive')for(let i=0;i<33;i++)url.searchParams.set('optional'+i,'1');
 let result;try{result=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw Error('CONFIGURED_CALLBACK_TRANSPORT_FAILED');}
 const reader=result.body.getReader();let size=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error('CONFIGURED_CALLBACK_BODY_TOO_LARGE');parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 const body=Buffer.concat(parts).toString('utf8');
 const allowed=['FORBIDDEN','INVALID_VERIFY_REQUEST','DEVELOPMENT_CHANNEL_UNAVAILABLE'];
 const row={name,httpStatus:result.status,body:body===challenge?'EXACT_CHALLENGE':allowed.includes(body)?body:'UNRECOGNIZED_RESPONSE',bodySha256:createHash('sha256').update(body).digest('hex'),pass:result.status===status&&(status!==200||body===challenge)};
 rows.push(row);console.log('MUSITU_CONFIGURED_CALLBACK_CASE='+JSON.stringify(row));
 if(!row.pass)throw Error('CONFIGURED_CALLBACK_EXPECTATION_FAILED');
}
try{
 await probe('configured verification with exact token',token,false,200);
 await probe('wrong verification token denied',randomUUID().repeat(2),false,403);
 await probe('six query fields with optional metadata accepted',token,'metadata',200);
 await probe('wrong token with optional metadata denied',randomUUID().repeat(2),'metadata',403);
 await probe('duplicate required field denied',token,'duplicate',400);
 await probe('excessive query fields denied',token,'excessive',400);
 console.log('MUSITU_CONFIGURED_CALLBACK_QUALIFICATION='+JSON.stringify({runId:randomUUID(),target:target.origin,observedAt:new Date().toISOString(),scope:'GENUINE_DIRECT_HTTP_VERIFICATION_NO_META_EVENT_OR_DB_WRITE',pass:rows.length,fail:0}));
}catch(error){console.log('MUSITU_CONFIGURED_CALLBACK_FAILURE='+JSON.stringify({code:['CONFIGURED_CALLBACK_TRANSPORT_FAILED','CONFIGURED_CALLBACK_BODY_TOO_LARGE','CONFIGURED_CALLBACK_EXPECTATION_FAILED'].includes(error.message)?error.message:'CONFIGURED_CALLBACK_FAILED',noMetaEventOrSend:true}));process.exitCode=1;}
