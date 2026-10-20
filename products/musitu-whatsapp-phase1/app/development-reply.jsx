'use client';
import {useEffect,useRef,useState} from 'react';
export default function DevelopmentReply({tenant,conversationId,messageId}){
 const active=useRef(true),key=useRef(null);key.current??=crypto.randomUUID();
 const[body,setBody]=useState('MUSITU test reply: your message was received and stored securely. This is a development test.');
 const[approved,setApproved]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const path=`/api/tenants/${encodeURIComponent(tenant)}`;
 async function check(){
  setBusy(true);try{const r=await fetch(path+'/development-replies',{cache:'no-store'});if(!active.current)return;if(!r.ok)throw Error('Reply status is unavailable. Sign in as the test business owner.');const d=await r.json();if(!active.current)return;if(d.tenantId!==tenant||!Array.isArray(d.data))throw Error('Reply status rejected.');const attempt=d.data.find(a=>a.conversationId===conversationId&&a.messageId===messageId);if(attempt){setSubmitted(true);setNotice(`Reply status: ${attempt.status}. ${attempt.status==='UNKNOWN'?'Do not send again; the outcome requires reconciliation.':''}`);}else{setSubmitted(false);setNotice('No recorded attempt for this message. Review the text and consent before submitting.');}}
  catch(e){if(active.current)setNotice(e.message);}finally{if(active.current)setBusy(false);}
 }
 async function submit(e){
  e.preventDefault();if(busy||submitted||!approved||!consent)return;setBusy(true);setSubmitted(true);setNotice('Submitting the reviewed development reply…');
  try{const r=await fetch(path+`/conversations/${encodeURIComponent(conversationId)}/development-reply`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body,messageId,requestKey:key.current,approveText:approved,confirmOwnNumber:consent})});if(!active.current)return;if(!r.ok)throw Error('Reply was denied or its outcome is unavailable. Check reply status before taking another action.');const d=await r.json();if(!active.current)return;if(d.tenantId!==tenant)throw Error('Reply response rejected.');setNotice(`Reply status: ${d.data.status}. ${d.data.status==='ACCEPTED'?'Accepted by Meta; delivery is not yet confirmed.':d.data.status==='UNKNOWN'?'Do not send again; the outcome requires reconciliation.':''}`);}
  catch(e){if(active.current)setNotice(e.message);}finally{if(active.current)setBusy(false);}
 }
 return <section aria-label="Development reply review" className="panel development-reply"><h3>Review one test reply</h3><p>Only the business owner can send to the verified test recipient. Public customer messaging remains disabled.</p><form className="quick-book" onSubmit={submit}><label>Exact reply text<textarea name="reply" rows={4} value={body} onChange={e=>{setBody(e.target.value);setApproved(false);}} required maxLength={1000} disabled={busy||submitted}/></label><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} required disabled={busy||submitted}/> I reviewed and approve this exact reply.</label><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required disabled={busy||submitted}/> I own the verified test WhatsApp number and consent to this single service reply.</label><button disabled={busy||submitted||!approved||!consent||!body.trim()}>Approve and send one test reply</button></form><button disabled={busy} onClick={check}>Check reply status</button>{notice&&<p role="status">{notice}</p>}<p>One attempt per incoming message. An uncertain outcome is never retried automatically.</p></section>;
}
