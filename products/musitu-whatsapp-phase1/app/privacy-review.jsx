'use client';
import {useEffect,useRef,useState} from 'react';
import {requestConversationPrivacyReview} from '../src/dashboard/privacy-review.mjs';
export default function PrivacyReview({tenant,conversationId}){
 const urls=useRef([]),pending=useRef(null),active=useRef(true);
 const [approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[files,setFiles]=useState(null),[notice,setNotice]=useState('');
 function clearFiles(){for(const url of urls.current)URL.revokeObjectURL(url);urls.current=[];}
 useEffect(()=>{active.current=true;return()=>{active.current=false;pending.current?.abort();clearFiles();};},[]);
 async function prepare(event){
  event.preventDefault();if(!approved||busy)return;clearFiles();setFiles(null);setBusy(true);setNotice('Preparing your encrypted review export…');pending.current=new AbortController();
  try{
   const result=await requestConversationPrivacyReview({tenantId:tenant,conversationId,signal:pending.current.signal});if(!active.current)return;
   const bundle=URL.createObjectURL(new Blob([result.encrypted],{type:'application/octet-stream'}));
   const key=URL.createObjectURL(new Blob([JSON.stringify(result.keyFile,null,2)],{type:'application/json'}));urls.current=[bundle,key];
   setFiles({bundle,key,id:result.requestId});setNotice('Ready. Save both files and keep the decryption key separately. Closing this conversation clears these download links.');
  }catch{if(active.current)setNotice('Export unavailable. Sign in as the development business owner and review this conversation again.');}
  finally{if(active.current)setBusy(false);}
 }
 return <section aria-label="Encrypted privacy review export" className="panel"><h3>Private conversation review</h3>
  <p>Download an encrypted review copy for this conversation. This does not deliver a subject-access response or erase records. Other systems, backups and records without a conversation link are excluded.</p>
  <form className="quick-book" onSubmit={prepare}><label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} disabled={busy}/> I am the business owner and approve preparing this private review copy.</label><button disabled={!approved||busy}>Prepare encrypted review export</button></form>
  {notice&&<p role="status">{notice}</p>}{files&&<p><a href={files.bundle} download={`MUSITU_PRIVACY_REVIEW_${files.id}.musituexport`}>Download encrypted export</a>{' · '}<a href={files.key} download={`MUSITU_PRIVACY_REVIEW_KEY_${files.id}.json`}>Download decryption key and receipt</a></p>}
 </section>;
}
