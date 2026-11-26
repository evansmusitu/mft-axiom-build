import {SCRIPT,need,OperatorHold} from './pins.mjs';
import {WORKER_ROOT} from './transport.mjs';
export async function observePrivateSchedule(t,{cron,not_before_ms,not_after_ms,phase,parseJson,WebSocketImpl=WebSocket}){
 const d=(await t.cf('POST',WORKER_ROOT+'/tails',{body:{filters:[]}})).data;
 let socket,timer,opened=false,count=0,settled=false;
 try{
 need(typeof d?.id==='string'&&/^[a-f0-9-]{32,36}$/.test(d.id)&&typeof d.url==='string'&&d.url.length<=8192,'A2OP_TAIL_METADATA_HOLD');
 const u=new URL(d.url);need(u.protocol==='wss:'&&!u.username&&!u.password&&['cloudflare.com','workers.dev','cloudflareworkers.com'].some(x=>u.hostname===x||u.hostname.endsWith('.'+x))&&Date.parse(d.expires_at)>not_after_ms,'A2OP_PRIVATE_TAIL_DESTINATION_HOLD');
 return await new Promise((resolve,reject)=>{
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{socket?.close();}catch{};error?reject(error):resolve(value);};
  timer=setTimeout(()=>finish(new OperatorHold('A2OP_SCHEDULE_OUTCOME_UNKNOWN_HOLD')),Math.max(1,not_after_ms-Date.now()+1000));
  socket=new WebSocketImpl(d.url,'trace-v1');socket.binaryType='arraybuffer';
  socket.addEventListener('open',()=>{opened=true;socket.send(JSON.stringify({debug:false}));});
  socket.addEventListener('error',()=>finish(new OperatorHold('A2OP_PRIVATE_TAIL_UNKNOWN_HOLD')));
  socket.addEventListener('close',()=>{if(!settled)finish(new OperatorHold('A2OP_PRIVATE_TAIL_CLOSED_HOLD'));});
  socket.addEventListener('message',event=>{try{
   need(opened&&++count<=256,'A2OP_TAIL_BUDGET_HOLD');let raw=event.data;if(raw instanceof ArrayBuffer)raw=new TextDecoder('utf-8',{fatal:true}).decode(raw);need(typeof raw==='string'&&raw.length<=131072,'A2OP_TAIL_MESSAGE_SIZE_HOLD');if(t.capturePrivate({provider:'Cloudflare private tail',response_complete:true,raw_message:raw,at_utc:new Date().toISOString()})===false)t.privateArchiveFailed=true;const trace=parseJson(raw);
   if(trace.scriptName!==SCRIPT||trace.event?.cron!==cron||!Number.isFinite(trace.event.scheduledTime)||trace.event.scheduledTime<not_before_ms||trace.event.scheduledTime>=not_after_ms)return;
   need(trace.outcome==='ok'&&Array.isArray(trace.exceptions)&&trace.exceptions.length===0,'A2OP_PRIVATE_SCHEDULE_FAILED_HOLD');
   if(phase==='GENESIS'){finish(null,{scheduled_time_ms:trace.event.scheduledTime,cron,outcome:'ok'});return;}
   const lines=Array.isArray(trace.logs)?trace.logs:[];const matches=lines.filter(x=>Array.isArray(x.message)&&x.message[0]==='AXIOM_A2_OPERATOR_SIGNED_RESULT'&&typeof x.message[1]==='string');
   need(matches.length===1,'A2OP_HOSTED_SIGNED_RESULT_MISSING_HOLD');finish(null,{scheduled_time_ms:trace.event.scheduledTime,cron,outcome:'ok',envelope:parseJson(matches[0].message[1])});
  }catch{finish(new OperatorHold('A2OP_PRIVATE_SCHEDULE_EVIDENCE_HOLD'));}});
 });}finally{
 clearTimeout(timer);try{socket?.close();}catch{}
 if(typeof d?.id==='string'&&/^[a-f0-9-]{32,36}$/.test(d.id)){
  const old=t.cleanupMode;t.cleanupMode=true;
  try{await t.cf('DELETE',WORKER_ROOT+'/tails/'+d.id,{allowStatus:[200]});}catch{throw new OperatorHold('A2OP_PRIVATE_TAIL_RETIREMENT_HOLD');}finally{t.cleanupMode=old;}
 }
 }
}
