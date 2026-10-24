import {useEffect,useState} from 'react';
import {api} from './lib/client';
import {Activity,ArrowRight,CheckCircle2,ClipboardCheck,Cloud,Download,FileCheck2,KeyRound,LockKeyhole,RefreshCw,ShieldCheck,Terminal,Workflow,AlertTriangle} from 'lucide-react';
import {newId,readMissions,storeMissions,type Mission} from './missionStore';
import './axiom-desk.css';
import IndependentProof from './IndependentProof';

type Capabilities={
 source:string;endpoint:string;publicTools:number;certifiedOperationTools:number;
 sample:{name:string;title:string}[];arithmeticAvailable:boolean;executionConfigured:boolean;credentialStored?:boolean;
 checkedAt:string;note:string;ledgerConfigured?:boolean;ledgerOperational?:boolean;issuerDiscovery?:{reachable:boolean;pkce:boolean;executionScope:boolean;registration:boolean;reason:string};runtimeRoleRestricted?:boolean;runtimeRoleChecked?:boolean;runtimeRoleOverprivileged?:boolean;oauthConfigured?:boolean;oauthSession?:{configured:boolean;connected:boolean;status:string;expiresAt?:string|null;approvedScope?:boolean;accessTokenFresh?:boolean;renewalRequired?:boolean};ledger?:{requests:number;auditEvents:number;todayUsed:number;dailyMax:number}|null;
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
 const [qualificationCode,setQualificationCode]=useState('');
 const [qualificationBusy,setQualificationBusy]=useState(false);
 const [oauthBusy,setOauthBusy]=useState(false);
 const [qualificationStatus,setQualificationStatus]=useState('');
 const [qualificationError,setQualificationError]=useState('');
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
 async function checkAccountQualification(){
  if(!qualificationCode.trim()){setQualificationError('Enter your private operator access code to authorize a non-compute scope check.');return;}
  setQualificationBusy(true);setQualificationStatus('');setQualificationError('');
  try{
   const {data}=await api.post('/api/axiom/preview',{action:'credential-preflight',
     approved:true,accessCode:qualificationCode});
   if(data.status!=='ACCOUNT_SCOPE_PREFLIGHT_ONLY'||data.operationExecuted!==false)
    throw Error('Unexpected Axiom preflight response. Provider computation was not authorized.');
   const label=data.providerGateStatus==='UNKNOWN_TOOL_AFTER_GATE'
     ?'PRELIMINARY AUTHORIZATION SIGNAL'
     :data.providerGateStatus==='CREDENTIAL_REJECTED'
      ?'CREDENTIAL WAS REJECTED':'AUTHORIZATION NOT YET CONFIRMED';
   let diagnosis='';
   if(data.providerGateStatus==='CREDENTIAL_REJECTED'){
    if(data.credentialKind==='NON_OAUTH_MUSITU_PREFIX')
      diagnosis=' The configured secret has a non-OAuth MUSITU-style prefix. It may be an account key or another secret, but it is not the short-lived access-token format expected by this gateway. A dedicated ATLAS OAuth authorization flow is needed.';
    else if(data.credentialKind==='OAUTH_REFRESH')
      diagnosis=' A refresh token cannot be used directly to invoke Axiom. A legitimate OAuth refresh exchange is needed.';
    else if(data.credentialKind==='OAUTH_ACCESS'&&data.identityVerification==='INVALID_OR_EXPIRED')
      diagnosis=' The existing OAuth access token is invalid or expired. The issuer provides one-hour access tokens, so a renewable OAuth session is required.';
    else if(data.credentialKind==='OAUTH_ACCESS')
      diagnosis=' An OAuth-style token is configured, but the gateway rejected execution; entitlement or issuer/resource restrictions may be responsible.';
    else diagnosis=' The credential is not recognizable as the published MUSITU OAuth access-token format. Check the dedicated ATLAS authorization, not your Neon login.';
   }
   setQualificationStatus(label+' — '+String(data.note||'')+diagnosis);
   setQualificationCode('');
  }catch(e){setQualificationError(e instanceof Error?e.message:'Unable to verify the private account connection.');}
  finally{setQualificationBusy(false);}
 }
 async function startAccountOAuth(){
  setQualificationError('');setQualificationStatus('');
  if(!qualificationCode.trim()){setQualificationError('Enter the dedicated Axiom operator code to authorize account linking.');return;}
  setOauthBusy(true);
  try{
   const r=await api.post('/api/axiom/preview',{action:'oauth-start',accessCode:qualificationCode,approved:true});
   const u=new URL(String(r.data?.authorizationUrl||''));
   if(r.data?.status!=='OWNER_OAUTH_APPROVAL_REQUIRED'||u.origin!=='https://auth.mftintelligence.com'
     ||u.pathname!=='/oauth/authorize')throw Error('Unexpected OAuth authorization destination.');
   setQualificationCode('');
   window.location.assign(u.toString());
  }catch(e){setQualificationError(e instanceof Error?e.message:'Owner OAuth linking is not yet available.');setOauthBusy(false);}
 }
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
  <section className="axiom-connection-setup" aria-label="Full account connection readiness">
   <span className="section-overline">ACCOUNT-BACKED AXIOM / FINAL CONNECTION GATES</span>
   <h2>Connect securely, without disclosing credentials.</h2>
   <p>The independent proof engine already works. Account-metered Axiom operations remain locked until two isolated credentials are qualified. There is no reason to buy AI credits or weaken the existing ChatGPT connector.</p>
   <div className="axiom-connection-grid">
     <article>
       <span className="axiom-step-num">01 / NEON RUNTIME</span>
       <strong>{remote?.runtimeRoleRestricted?'Restricted database role verified':'Restricted database login not yet verified'}</strong>
       <p>In your isolated Neon project <code>muddy-wildflower-85740352</code>, set a strong password on <code>atlas_web_limited</code> inside the Neon SQL Editor. Do not send that password in chat. The connected integration can then switch ATLAS to this restricted role.</p>
       <a href="https://console.neon.tech/" target="_blank" rel="noopener noreferrer">Open Neon SQL Editor →</a>
     </article>
     <article>
       <span className="axiom-step-num">02 / AXIOM ENTITLEMENT</span>
       <strong>{remote?.executionConfigured?'Provider execution configured':remote?.credentialStored?'Service credential stored · OAuth entitlement unverified':'Dedicated Axiom service credential required'}</strong>
       <p>The gateway requires a real MUSITU OAuth access token with <code>axiom.execute</code>; ordinary account keys and expired access tokens are rejected. The issuer's access tokens last one hour, so a permanent connection requires approved OAuth renewal. Existing secrets remain private.</p>
       <a href="https://vercel.com/evansmusitu/musitu-atlas-ai-lab/settings/environment-variables" target="_blank" rel="noopener noreferrer">Open private Vercel variables →</a>
     </article>
   </div>
   <div className="axiom-scope-preflight">
     <div><span className="section-overline">OWNER ACCOUNT LINK / RENEWABLE OAUTH</span><h3>{remote?.oauthSession?.connected?'Axiom account session linked':'Connect your real Axiom account securely'}</h3></div>
     <p>The MUSITU OAuth issuer receives your account key directly. ATLAS uses an authorization code with PKCE, encrypts resulting server-side tokens, and can renew access without keeping a one-hour static bearer. Neither your account key nor raw tokens are displayed in the website. Connection requires the Cloudflare owner to explicitly enable the exact ATLAS callback first.</p>
     <p className="axiom-issuer-readiness">
       <strong>Live OAuth issuer:</strong> {remote?.issuerDiscovery?.reachable&&remote.issuerDiscovery.pkce&&remote.issuerDiscovery.executionScope&&remote.issuerDiscovery.registration
        ?'ONLINE · PKCE S256 and axiom.execute supported'
        :remote?.issuerDiscovery?'Issuer discovery unavailable or incomplete':'Checking issuer metadata…'}
       {' · '}<strong>ATLAS website client:</strong> {remote?.oauthConfigured?'Configured':'Not yet authorized'}
     </p>
     <p><strong>Current state:</strong> {remote?.oauthConfigured?(remote?.oauthSession?.connected?(remote.oauthSession.renewalRequired?'Owner session linked; access token expired or near expiry. An issuer refresh is required before use. Account execution remains locked.':'Owner session linked with a fresh access token. Account execution remains separately approval-gated.'):'Ready for owner authorization on official MUSITU website.'):'OAuth callback/client configuration is still locked pending provider-side approval.'}</p>
     <div className="axiom-preflight-fields">
       <button type="button" disabled={!remote?.oauthConfigured||oauthBusy||!qualificationCode} onClick={startAccountOAuth}>{oauthBusy?'Opening MUSITU sign-in…':'Connect Axiom OAuth account'}</button>
     </div>
   </div>
   <div className="axiom-scope-preflight">
     <div><span className="section-overline">03 / VERIFY AUTHORIZATION WITHOUT COMPUTING</span><h3>Check the real Axiom account gate</h3></div>
     <p>This optional owner-authorized check verifies restricted Neon privileges and presents an intentionally nonexistent tool name to the Axiom OAuth gate. No registered computation is requested. An unknown-tool rejection is preliminary evidence only; it cannot certify real execution, usage charges or all permissions.</p>
     <p><strong>Access code:</strong> use the dedicated ATLAS Axiom operator code issued for this workspace, not the frontier-model code, Neon password, or Axiom bearer token.</p>
     <div className="axiom-preflight-fields">
       <input type="password" autoComplete="off" aria-label="Private operator code for permission check" placeholder="Private operator code" value={qualificationCode} onChange={e=>setQualificationCode(e.target.value.slice(0,200))}/>
       <button type="button" disabled={qualificationBusy||!qualificationCode} onClick={checkAccountQualification}>{qualificationBusy?'Checking…':'Check account authorization (no compute)'}</button>
     </div>
     {qualificationStatus&&<p role="status" className="axiom-preflight-good">{qualificationStatus}</p>}
     {qualificationError&&<p role="alert" className="axiom-preflight-error">{qualificationError}</p>}
   </div>
   <p className="axiom-connection-boundary">A connection is not fully active merely because the registry responds. The account-token gate, runtime role, owner code, explicit per-request approval, one-shot idempotency and daily quota must all pass.</p>
  </section>
  <section className="axiom-live">
   <div className="axiom-head"><div><span className="section-overline"><Activity size={14}/> LIVE CAPABILITY FABRIC</span><h2>MUSITU Axiom MCP</h2></div><button type="button" onClick={inspect} disabled={loading}><RefreshCw size={15}/> Refresh registry</button></div>
   {remote?<><div className="axiom-stats"><div><strong>{remote.certifiedOperationTools}</strong><span>Certified operation tools reported live</span></div><div><strong>{remote.publicTools}</strong><span>MCP tools returned</span></div><div><strong>{remote.arithmeticAvailable?'DISCOVERED':'NOT FOUND'}</strong><span>arithmetic.evaluate</span></div></div>
   <div className="axiom-registry">{remote.sample.map(x=><span key={x.name}>{x.name.replace(/^axiom_/,'').replaceAll('_','.')}</span>)}</div>
   <div className="axiom-ledger-connect"><strong>{remote.ledgerOperational&&remote.runtimeRoleRestricted?'NEON LEDGER QUALIFIED':remote.ledgerOperational?'NEON CONNECTED · ROLE UNSAFE':'LEDGER NOT VERIFIED'}</strong><span>{remote.ledgerOperational&&remote.runtimeRoleRestricted?'Persistent one-shot idempotency, audit events and limited role verified.':'Remote account execution remains locked until Neon least-privilege checks pass and an authorized Axiom account is connected.'}</span>{remote.ledger&&<small>Requests: {remote.ledger.requests} · Audit events: {remote.ledger.auditEvents} · Today: {remote.ledger.todayUsed}/{remote.ledger.dailyMax}</small>}</div>
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
