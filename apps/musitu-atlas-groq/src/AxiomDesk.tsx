import {useEffect,useState} from 'react';
import {api} from './lib/client';
import {Activity,ArrowRight,CheckCircle2,ClipboardCheck,Cloud,Download,FileCheck2,KeyRound,LockKeyhole,RefreshCw,ShieldCheck,Terminal,Workflow,AlertTriangle} from 'lucide-react';
import {newId,readMissions,storeMissions,type Mission} from './missionStore';
import './axiom-desk.css';
import IndependentProof from './IndependentProof';

type Capabilities={
 source:string;endpoint:string;publicTools:number;certifiedOperationTools:number;
 sample:{name:string;title:string}[];arithmeticAvailable:boolean;executionConfigured:boolean;
 checkedAt:string;note:string;ledgerConfigured?:boolean;ledgerOperational?:boolean;ledger?:{requests:number;auditEvents:number;todayUsed:number;dailyMax:number}|null;
};
type Preview={
 previewVersion:string;operation:string;args:{expression:string};digest:string;
 status:string;executionConfigured:boolean;requiresOperatorConsent:boolean;note:string;
};
type Receipt={
 requestId:string;origin:string;status:string;completedAt:string;requestSha256:string;
 resultSha256:string;output:{operation:string;expression:string;result:string;verified:boolean|null;kernelVersion:string|null;computeUnits:number|null};
 evidenceType:string;retryPolicy:string;
 independentVerification?:{matched:boolean;kernel:string;exact:string;decimal:string;providerAgreement:{match:boolean;exactAgreement:boolean}};
};
const example='(2+3)*4';
export default function AxiomDesk({openMissions}:{openMissions:()=>void}){
 const [remote,setRemote]=useState<Capabilities|null>(null);
 const [remoteError,setRemoteError]=useState('');
 const [loading,setLoading]=useState(false);
 const [expression,setExpression]=useState(example);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [receipt,setReceipt]=useState<Receipt|null>(null);
 const [consent,setConsent]=useState(false);
 const [requestKey,setRequestKey]=useState('');
 const [lastStatus,setLastStatus]=useState('');
 const [code,setCode]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [saved,setSaved]=useState(false);
 async function inspect(){
  setLoading(true);setRemoteError('');
  try{
   const r=await api.get('/api/axiom/capabilities');
   if(!r.data||!r.data.source||typeof r.data.certifiedOperationTools!=='number')throw Error('Unexpected capability registry response');
   setRemote(r.data as Capabilities);
  }catch(e){setRemoteError(e instanceof Error?e.message:'The live Axiom registry is unreachable.');setRemote(null);}
  finally{setLoading(false);}
 }
 useEffect(()=>{void inspect();},[]);
 async function review(e:React.FormEvent){
  e.preventDefault();setError('');setNotice('');setReceipt(null);setSaved(false);setPreview(null);setConsent(false);setLastStatus('');setRequestKey(crypto.randomUUID());
  if(busy)return;
  setBusy(true);
  try{
   const r=await api.post('/api/axiom/preview',{expression});
   const v=r.data as Preview;
   if(!v?.digest||v.digest.length!==64)throw Error('Invalid preview digest');
   setPreview(v);setNotice('Preview recorded. Axiom has not executed this request.');
  }catch(e){setError(e instanceof Error?e.message:'Preview failed.');}
  finally{setBusy(false);}
 }
 async function checkStatus(){
  if(!requestKey||!code){setError('Your private code and latest request key are needed to inspect status.');return;}
  setBusy(true);setError('');
  try{
   const result=await api.post('/api/axiom/preview',{action:'status',idempotencyKey:requestKey,accessCode:code});
   const entry=result.data;
   setLastStatus(String(entry.status)+' · '+String(entry.requestId));
   if(entry.status==='SUCCEEDED'&&entry.result?.status==='PROVIDER_EXECUTED')setReceipt(entry.result as Receipt);
   if(entry.status==='DISPATCHING'||entry.status==='REVIEW_REQUIRED')setNotice('Outcome uncertain; no automatic retry is permitted.');
  }catch(error){setError(error instanceof Error?error.message:'Status check unavailable.');}
  finally{setBusy(false);}
 }
 async function run(){
  setError('');setNotice('');setReceipt(null);setSaved(false);
  if(!preview||!consent||!code){setError('Review, consent and a private operator code are required.');return;}
  if(expression.trim()!==preview.args.expression){setError('The expression changed. Preview again before execution.');return;}
  if(busy)return;
  setBusy(true);
  try{
   const r=await api.post('/api/axiom/execute',{
    expression:preview.args.expression,digest:preview.digest,
    approved:true,accessCode:code,idempotencyKey:requestKey
   });
   const v=r.data as Receipt;
   if(v.status!=='PROVIDER_EXECUTED'||!v?.output?.result||!v?.resultSha256)throw Error('Malformed execution receipt');
   setReceipt(v);setNotice('Axiom returned an authenticated result. Review provider evidence before using it.');
   setCode('');
  }catch(e){setError((e instanceof Error?e.message:'Execution failed')+'. Do not retry an uncertain operation without reviewing account activity.');}
  finally{setBusy(false);}
 }
 function download(){
  if(!receipt)return;
  const blob=new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='musitu-axiom-evidence-'+receipt.requestId+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function saveMission(){
  if(!receipt||saved)return;
  const existing=readMissions();
  if(existing.length>=30){setError('Mission Control has reached its 30-mission local limit. Export/archive an old mission first.');return;}
  const m:Mission={id:newId(),goal:'Review Axiom evidence for '+receipt.output.expression,title:'Axiom · '+receipt.output.expression,
   createdAt:new Date().toISOString(),origin:'manual',
   summary:'Axiom provider returned '+receipt.output.result+'. Cross-checked by independent ATLAS kernel: '+String(receipt.independentVerification?.matched===true)+'. File SHA-256 is an integrity fingerprint, not an externally signed audit.',
   steps:[
    {id:newId(),title:'Run allowlisted Axiom computation',detail:'Authenticated provider execution for '+receipt.output.expression,success:'Axiom provided a successful operation result and request receipt.',status:'done',evidence:'Axiom request: '+receipt.requestId+'\nOutput: '+receipt.output.result+'\nLocal result digest: '+receipt.resultSha256},
    {id:newId(),title:'Verify result independently',detail:'Verify the result against an independent method and assess claimed precision.',success:'Independent checker confirms the result and tolerances.',status:'todo',evidence:''},
    {id:newId(),title:'Approve downstream use',detail:'Review intended usage; require confirmation for any external or financial action.',success:'Authorized decision supported by recorded evidence.',status:'todo',evidence:''}
   ]};
  if(!storeMissions([m,...existing])){setError('Saving to this browser was unsuccessful. Download the evidence instead.');return;}
  setSaved(true);setNotice('Provider receipt attached to a new local mission. No outside action was performed.');
 }
 return <main className="axiom-desk inner-page">
  <section className="axiom-intro"><span className="section-overline">MUSITU ATLAS / AXIOM EXECUTION FABRIC</span><h1>From intent.<br/><em>To evidence.</em></h1>
   <p>Real MUSITU Axiom capability discovery, reviewed operation requests and provider-returned evidence. Private execution remains fail-closed until its own account credential is configured.</p>
  </section>
  <section className="axiom-live">
   <div className="axiom-head"><div><span className="section-overline"><Activity size={14}/> LIVE CAPABILITY FABRIC</span><h2>MUSITU Axiom MCP</h2></div><button type="button" onClick={inspect} disabled={loading}><RefreshCw size={15}/> Refresh registry</button></div>
   {remote?<><div className="axiom-stats"><div><strong>{remote.certifiedOperationTools}</strong><span>Certified operation tools reported live</span></div><div><strong>{remote.publicTools}</strong><span>MCP tools returned</span></div><div><strong>{remote.arithmeticAvailable?'DISCOVERED':'NOT FOUND'}</strong><span>arithmetic.evaluate</span></div></div>
   <div className="axiom-registry">{remote.sample.map(x=><span key={x.name}>{x.name.replace(/^axiom_/,'').replaceAll('_','.')}</span>)}</div>
   <div className="axiom-ledger-connect"><strong>{remote.ledgerOperational?'NEON LEDGER ONLINE':'LEDGER NOT VERIFIED'}</strong><span>{remote.ledgerOperational?'Persistent one-shot idempotency, audited events and a 20-per-day request ceiling are connected.':'Durable execution remains unavailable until the isolated Neon database is verified.'}</span>{remote.ledger&&<small>Requests: {remote.ledger.requests} · Audit events: {remote.ledger.auditEvents} · Today: {remote.ledger.todayUsed}/{remote.ledger.dailyMax}</small>}</div>
   <p className="axiom-small"><Cloud size={14}/> Source: {remote.endpoint} / MCP tools/list • Checked {new Date(remote.checkedAt).toLocaleString()}. This metadata is from the live Axiom service, not generated by an AI model.</p></>:
   <div className="axiom-notice">{loading?'Checking the live MUSITU Axiom registry…':'Registry not verified: '+remoteError}</div>}
  </section>
  <section className="axiom-two">
   <div className="axiom-card"><span className="section-overline">01 / BOUNDED OPERATION</span><h2>Review before computing.</h2>
    <form onSubmit={review}><label htmlFor="axiom-expression">Certified arithmetic expression</label><input id="axiom-expression" spellCheck={false} value={expression} onChange={e=>{setExpression(e.target.value.slice(0,160));setPreview(null);setReceipt(null);setSaved(false);setConsent(false);}} placeholder="(2+3)*4"/>
     <div className="axiom-rule"><Terminal size={15}/> Only arithmetic.evaluate is currently permitted. No arbitrary tools, trading, billing, or customer data mutations.</div>
     <button type="submit" className="axiom-main-button" disabled={busy||!expression.trim()}>Review operation <ArrowRight size={16}/></button>
    </form>
    {preview&&<div className="axiom-preview"><span className="section-overline">PREVIEW • NOT EXECUTED</span><strong>{preview.operation}</strong><code>{preview.args.expression}</code><small>Request fingerprint: {preview.digest.slice(0,20)}…</small>
      <div className="axiom-state"><ShieldCheck size={16}/>{preview.executionConfigured?'Account connection configured; execution still requires individual approval.':'Actual execution blocked: entitled server-side Axiom credential has not been configured.'}</div>
      {preview.executionConfigured&&<div className="axiom-approval"><label className="axiom-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I approve ONE Axiom compute request. It may consume account compute units; no automatic retries.</label>
       <label htmlFor="axiom-code">Private operator access code</label><input id="axiom-code" type="password" autoComplete="off" value={code} onChange={e=>setCode(e.target.value.slice(0,200))} placeholder="Stored only in temporary page memory"/>
       <button type="button" className="axiom-main-button" disabled={busy||!consent||!code||!requestKey} onClick={run}><KeyRound size={16}/> Execute one operation</button><button type="button" className="axiom-ledger-button" disabled={busy||!code||!requestKey} onClick={checkStatus}>Check status (never resubmit)</button>{lastStatus&&<p role="status">{lastStatus}</p>}
      </div>}
    </div>}
    {error&&<p className="axiom-error" role="alert"><AlertTriangle size={17}/>{error}</p>}
    {notice&&<p className="axiom-ok" role="status"><CheckCircle2 size={17}/>{notice}</p>}
   </div>
   <div className="axiom-card"><span className="section-overline">02 / PROOF-CARRYING WORKFLOW</span><h2>Verified claims, not AI fiction.</h2>
    <div className="axiom-stage"><span>01</span><div><strong>Discover</strong><p>Read the actual registered tools from the MUSITU Axiom MCP service.</p></div></div>
    <div className="axiom-stage"><span>02</span><div><strong>Review</strong><p>Pin an allowlisted operation and the exact input with a SHA-256 fingerprint.</p></div></div>
    <div className="axiom-stage"><span>03</span><div><strong>Authorize</strong><p>Require a configured Axiom account, private operator code and explicit one-request consent.</p></div></div>
    <div className="axiom-stage"><span>04</span><div><strong>Verify and preserve</strong><p>Compare certified Axiom arithmetic with a separate exact rational parser. Download the evidence; local hashes are not signed audits.</p></div></div>
    <p className="axiom-boundary"><LockKeyhole size={16}/> Website AI models cannot invoke Axiom execution automatically. SSO, account access, allowlisting and separate approval gates remain in force.</p>
   </div>
  </section>
  <IndependentProof openMissions={openMissions}/>
  {receipt&&<section className="axiom-receipt"><div className="axiom-head"><div><span className="section-overline"><FileCheck2 size={14}/> AUTHENTICATED AXIOM RESULT</span><h2>{receipt.output.result}</h2></div><span className="axiom-status">PROVIDER RETURNED</span></div>
   <div className="axiom-receipt-grid"><div><span>Operation</span><strong>{receipt.output.operation}</strong></div><div><span>Provider verification field</span><strong>{String(receipt.output.verified)}</strong></div><div><span>Independent ATLAS verification</span><strong>{receipt.independentVerification?.matched===true?'MATCHED':'NOT REPORTED'}</strong></div><div><span>Compute units reported</span><strong>{receipt.output.computeUnits??'Not reported'}</strong></div><div><span>Timestamp</span><strong>{new Date(receipt.completedAt).toLocaleString()}</strong></div></div>
   <p>Receipt fingerprint: <code>{receipt.resultSha256}</code></p>
   <div className="axiom-actions"><button type="button" onClick={download}><Download size={16}/> Download evidence JSON</button><button type="button" onClick={saveMission} disabled={saved}><ClipboardCheck size={16}/>{saved?'Added to Mission Control':'Add result to Mission Control'}</button>{saved&&<button type="button" onClick={openMissions}><Workflow size={16}/> Open mission</button>}</div>
  </section>}
  <p className="axiom-footer"><ShieldCheck size={16}/> Current remote bridge only permits one certified arithmetic operation. Axiom account-metered operations will not be sent while credentials are missing. No broker orders, payments, emails or external writes are authorized by this page.</p>
 </main>;
}
