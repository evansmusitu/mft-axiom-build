'use client';
import {useState} from 'react';
export default function AiResumption({conversationId,optedOut,disabled,onResume}){
 const [confirmed,setConfirmed]=useState(false);
 return <form className="quick-book" onSubmit={event=>{event.preventDefault();if(confirmed&&!optedOut&&!disabled)onResume(conversationId);}}>
  <p>An owner can return this conversation to AI draft assistance. Every suggested answer still requires human review; returning does not send a message.</p>
  <label><input type="checkbox" checked={confirmed} disabled={disabled||optedOut} onChange={event=>setConfirmed(event.target.checked)}/> I approve returning this conversation to AI draft assistance</label>
  <button disabled={disabled||optedOut||!confirmed}>Return to AI draft assistance</button>
 </form>;
}
