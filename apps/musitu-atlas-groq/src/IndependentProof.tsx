import {useState} from 'react';
import {api} from './lib/client';
import {CheckCircle2,Download,ShieldCheck,ClipboardCheck,Workflow,AlertTriangle} from 'lucide-react';
import {readMissions,storeMissions,newId,type Mission} from './missionStore';
import './independent-proof.css';
type Proof={
 status:string;source:string;operation:string;requestSha256:string;evidenceSha256:string;
 proof:{kernel:string;expression:string;exact:string;decimal:string;decimalIsTruncated:boolean;verifiedBy:string;comparison:null|{match:boolean}};
 chargedComputeUnits:number;providerWasCalled:boolean;modelWasCalled:boolean;completedAt:string;evidenceFingerprintMeaning:string;
};
export default function IndependentProof({openMissions}:{openMissions:()=>void}){
 const [expression,setExpression]=useState('(2+3)*4');
 const [result,setResult]=useState<Proof|null>(null);
 const [busy,setBusy]=useState(false);
 const [saved,setSaved]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [replayMessage,setReplayMessage]=useState('');
 const [replayError,setReplayError]=useState('');
 async function calculate(e:React.FormEvent){
  e.preventDefault();setError('');setNotice('');setResult(null);setSaved(false);
  if(busy)return;
  setBusy(true);
  try{
   const {data}=await api.post('/api/axiom/verify',{expression:expression.trim()});
   const proof=data as Proof;
   if(proof.status!=='INDEPENDENT_ATLAS_COMPUTATION'||typeof proof?.proof?.exact!=='string'||!proof.evidenceSha256)
    throw Error('Result did not meet the independent proof contract.');
   if(proof.providerWasCalled!==false||proof.modelWasCalled!==false||proof.chargedComputeUnits!==0)
    throw Error('Unexpected nonlocal execution status.');
   setResult(proof);setNotice('Executed by ATLAS exact arithmetic; no Axiom or AI provider request was sent.');
  }catch(err){setError(err instanceof Error?err.message:'Unable to compute the independent proof.');}
  finally{setBusy(false);}
 }
 function download(){
  if(!result)return;
  const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;
  a.download='atlas-exact-proof-'+result.evidenceSha256.slice(0,18)+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function replayFile(event:React.ChangeEvent<HTMLInputElement>){
   setReplayMessage('');setReplayError('');
   const input=event.currentTarget;
   const file=input.files?.[0];
   if(!file)return;
   if(file.size>13000){setReplayError('Proof file exceeds the 13 KB replay limit.');return;}
   try{
    const raw=await file.text();
    const receipt=JSON.parse(raw) as unknown;
    const {data}=await api.post('/api/axiom/verify',{action:'replay',receipt});
    if(data?.status!=='PROOF_REPLAY_CONSISTENT'||data.digestMatches!==true||data.resultMatches!==true)
      throw Error('Replay did not confirm proof consistency.');
    setReplayMessage('Verified replay: exact result '+data.recomputedExact+'. Receipt calculation and SHA-256 are consistent. Issuer identity is not authenticated.');
   }catch(err){setReplayError(err instanceof Error?err.message:'Proof replay rejected.');}
   input.value='';
 }
 function save(){
  if(!result||saved)return;
  const prior=readMissions();
  if(prior.length>=30){setError('Mission Control has reached its local 30-mission limit. Export an old mission first.');return;}
  const mission:Mission={
   id:newId(),goal:'Review exact arithmetic evidence: '+result.proof.expression,
   title:'Verified ATLAS proof · '+result.proof.expression,
   summary:'ATLAS independent rational kernel exact result '+result.proof.exact+'. Source: local server verification endpoint. NOT an external Axiom execution or a signed audit.',
   createdAt:new Date().toISOString(),origin:'manual',
   steps:[
    {id:newId(),title:'Calculate exact rational proof',detail:'Deterministic bounded parser with exact arithmetic. No third-party compute request.',success:'A JSON proof receipt with SHA-256 integrity fingerprint is produced.',status:'done',evidence:'Exact: '+result.proof.exact+'\nReceipt hash: '+result.evidenceSha256+'\nKernel: '+result.proof.kernel},
    {id:newId(),title:'Independent second-system verification',detail:'If relevant, compare the exact result against another implementation or authenticated Axiom compute.',success:'Second system agrees to the documented tolerance.',status:'todo',evidence:''},
    {id:newId(),title:'Approve downstream use',detail:'Review inputs, assumptions and intended external impact.',success:'Authorized reviewer signs off on any consequential action.',status:'todo',evidence:''}
   ]
  };
  if(!storeMissions([mission,...prior])){setError('Local browser saving failed; export your proof JSON instead.');return;}
  setSaved(true);setNotice('Proof added to browser-local Mission Control; no external actions performed.');
 }
 return <section className="proof-panel" aria-label="Independent proof engine">
  <div className="proof-head"><div><span className="section-overline">ZERO-CREDIT EXECUTION · ATLAS RATIONAL KERNEL</span><h2>Verify an answer without AI.</h2><p>Compute exact arithmetic directly in ATLAS. Independent of MUSITU Axiom, OpenAI, Anthropic or Groq. No model credits and no account-metered Axiom compute.</p></div><span className="proof-free"><ShieldCheck size={15}/> $0 / RUN</span></div>
  <form className="proof-form" onSubmit={calculate}><label htmlFor="proof-input">Arithmetic expression</label><div><input id="proof-input" value={expression} maxLength={160} spellCheck={false} onChange={e=>{setExpression(e.target.value);setResult(null);setSaved(false);setNotice('');}} placeholder="(2+3)*4" aria-describedby="proof-format"/><button type="submit" disabled={busy||!expression.trim()}><CheckCircle2 size={17}/>{busy?'Computing…':'Verify independently'}</button></div><small id="proof-format">Exact rational arithmetic: +, −, ×, ÷, %, ^ and parentheses. No eval, external AI, payments, trades or code execution.</small></form>
  {error&&<p className="proof-error" role="alert"><AlertTriangle size={16}/>{error}</p>}
  {notice&&<p className="proof-notice" role="status"><CheckCircle2 size={16}/>{notice}</p>}
  {result&&<article className="proof-receipt" aria-live="polite">
   <div><span>INDEPENDENT EXACT RESULT</span><strong>{result.proof.decimal}{result.proof.decimalIsTruncated?'…':''}</strong><small>Exact fraction: {result.proof.exact}</small></div>
   <dl><div><dt>Verifier</dt><dd>{result.proof.kernel}</dd></div><div><dt>External provider requests</dt><dd>0</dd></div><div><dt>Axiom compute units</dt><dd>{result.chargedComputeUnits}</dd></div><div><dt>Evidence digest</dt><dd className="proof-digest">{result.evidenceSha256}</dd></div></dl>
   <p>A locally calculated SHA-256 fingerprint is not a digital signature or independently anchored audit. Result evidence is exported with its source and algorithm version.</p>
   <div className="proof-actions"><button type="button" onClick={download}><Download size={16}/> Download JSON proof</button><button type="button" disabled={saved} onClick={save}><ClipboardCheck size={16}/>{saved?'Saved to Mission Control':'Create evidence mission'}</button>{saved&&<button type="button" onClick={openMissions}><Workflow size={16}/> Open mission</button>}</div>
   <div className="proof-replay"><label htmlFor="proof-import">Replay a downloaded proof JSON file — verify numerical result and fingerprint</label><input id="proof-import" type="file" accept=".json,application/json" onChange={replayFile}/>{replayMessage&&<p role="status" className="proof-replay-success">{replayMessage}</p>}{replayError&&<p role="alert" className="proof-replay-error">{replayError}</p>}</div>
  </article>}
 </section>;
}
