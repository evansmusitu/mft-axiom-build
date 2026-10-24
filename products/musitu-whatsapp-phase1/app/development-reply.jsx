'use client';
import {useEffect,useRef,useState} from 'react';
import {developmentReplyFailureNotice} from '../src/staging/development-reply-errors.mjs';
import {reviewDevelopmentReplyStatus} from '../src/staging/development-reply-status.mjs';

const initialBody='MUSITU test reply: your message was received and stored securely. This is a development test.';

export default function DevelopmentReply({tenant,conversationId,messageId}){
 const active=useRef(false),checkSequence=useRef(0),key=useRef(null);
 const selection=`${tenant}\u0000${conversationId}\u0000${messageId}`;
 const[body,setBody]=useState(initialBody),[approved,setApproved]=useState(false),[consent,setConsent]=useState(false);
 const[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false);
 const[status,setStatus]=useState({selection:null,allowed:false,notice:'Checking reply status…'});
 const path=`/api/tenants/${encodeURIComponent(tenant)}`;
 const ready=status.selection===selection&&status.allowed&&!busy&&!submitted;

 async function readStatus(){
  const r=await fetch(path+'/development-replies',{cache:'no-store'});
  if(!r.ok)throw Error('Reply status is unavailable. Sign in as the test business owner.');
  return reviewDevelopmentReplyStatus(await r.json(),{tenant,conversationId,messageId});
 }
 async function check(){
  const sequence=++checkSequence.current;
  setBusy(true);setStatus({selection,allowed:false,notice:'Checking reply status…'});
  try{
   const result=await readStatus();
   if(active.current&&sequence===checkSequence.current)setStatus({selection,...result});
  }catch(e){
   if(active.current&&sequence===checkSequence.current)setStatus({selection,allowed:false,notice:e.message});
  }finally{if(active.current&&sequence===checkSequence.current)setBusy(false);}
 }
 useEffect(()=>{
  active.current=true;key.current=crypto.randomUUID();
  setBody(initialBody);setApproved(false);setConsent(false);setSubmitted(false);
  void check();
  return()=>{active.current=false;checkSequence.current++;};
 },[selection]);

 async function submit(e){
  e.preventDefault();
  if(!ready||!approved||!consent||!body.trim())return;
  const sequence=++checkSequence.current;
  setBusy(true);setStatus({selection,allowed:false,notice:'Rechecking reply status…'});
  try{
   const preflight=await readStatus();
   if(!active.current||sequence!==checkSequence.current)return;
   if(!preflight.allowed){setStatus({selection,...preflight});return;}
   setSubmitted(true);setStatus({selection,allowed:false,notice:'Submitting the reviewed development reply…'});
   const r=await fetch(path+`/conversations/${encodeURIComponent(conversationId)}/development-reply`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body,messageId,requestKey:key.current,approveText:approved,confirmOwnNumber:consent})});
   if(!active.current||sequence!==checkSequence.current)return;
   const d=await r.json();
   if(!active.current||sequence!==checkSequence.current)return;
   if(!r.ok)throw Error(developmentReplyFailureNotice(d?.error));
   if(d.tenantId!==tenant)throw Error('Reply response rejected.');
   setStatus({selection,allowed:false,notice:`Reply status: ${d.data.status}. ${d.data.status==='ACCEPTED'?'Accepted by Meta; delivery is not yet confirmed.':d.data.status==='UNKNOWN'?'Do not send again; the outcome requires reconciliation.':''}`});
  }catch(e){
   if(active.current&&sequence===checkSequence.current)setStatus({selection,allowed:false,notice:e.message});
  }finally{if(active.current&&sequence===checkSequence.current)setBusy(false);}
 }
 return <section aria-label="Development reply review" className="panel development-reply"><h3>Review one test reply</h3><p>Only the business owner can send to the verified test recipient. Public customer messaging remains disabled.</p><form className="quick-book" onSubmit={submit}><label>Exact reply text<textarea name="reply" rows={4} value={body} onChange={e=>{setBody(e.target.value);setApproved(false);}} required maxLength={1000} disabled={!ready}/></label><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} required disabled={!ready}/> I reviewed and approve this exact reply.</label><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required disabled={!ready}/> I own the verified test WhatsApp number and consent to this single service reply.</label><button disabled={!ready||!approved||!consent||!body.trim()}>Approve and send one test reply</button></form><button disabled={busy} onClick={check}>Check reply status</button>{status.notice&&<p role="status">{status.notice}</p>}<p>One attempt per incoming message. An uncertain outcome is never retried automatically.</p></section>;
}
