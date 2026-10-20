import {useEffect,useState} from 'react';
import {api} from './lib/client';
import {AlertTriangle,ArrowUpRight,CheckCircle2,Clock3,FlaskConical,KeyRound,LockKeyhole,Play,ShieldCheck,Signal,SlidersHorizontal,Sparkles} from 'lucide-react';
import './model-lab.css';
type Model={id:string;label:string;model:string;provider:string;available:boolean;tier:string};
type Result={model:string;provider:string;answer:string;latencyMs:number;answerWords:number;measuredAt:string;note:string;providerCostUsd?:number|null;generationId?:string|null;promptTokens?:number|null;completionTokens?:number|null};
const defaultPrompt='Design three concrete, testable steps for getting the first paying customer for a new AI software service with a $0 marketing budget. Identify the biggest risk and one measurable success criterion.';
type Pick = {task:string;title:string;model:string;label:string;why:string;officialEvidence:string;source:string;sourcePublisher:string;relativeCost:string;maxOutputTokens:number;costForOneThousandInAndFiveHundredOut:number;available:boolean};
export default function ModelLab({onChoose}:{onChoose:(mode:string)=>void}){
 const [catalog,setCatalog]=useState<Model[]>([]);
 const [officialPicks,setOfficialPicks]=useState<Pick[]>([]);
 const [routingError,setRoutingError]=useState('');
 const [selected,setSelected]=useState('openai_sol');
 const [prompt,setPrompt]=useState(defaultPrompt);
 const [approved,setApproved]=useState(false);
 const [accessCode,setAccessCode]=useState('');
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 const [error,setError]=useState('');
 const [results,setResults]=useState<Record<string,Result>>({});
 useEffect(()=>{let live=true;api.get('/api/models').then(r=>{if(live&&Array.isArray(r.data?.models))setCatalog(r.data.models);}).catch(()=>{if(live)setError('Could not load available model status from the backend.');});return()=>{live=false;};},[]);
 useEffect(()=>{let live=true;api.get('/api/official-recommendations').then(r=>{if(live&&Array.isArray(r.data?.recommendations))setOfficialPicks(r.data.recommendations);}).catch(()=>{if(live)setRoutingError('Official recommendations currently unavailable');});return()=>{live=false;};},[]);
 const model=catalog.find(m=>m.id===selected);
 const frontier=model?.tier==='frontier';
 const enabled=Boolean(model?.available);
 async function run(e:React.FormEvent){
  e.preventDefault();setError('');setStatus('');
  if(busy||!enabled){setError('This provider is not enabled on ATLAS.');return;}
  if(prompt.trim().length<12){setError('Write a question with at least 12 characters.');return;}
  if(frontier&&(!approved||!accessCode)){setError('A frontier test needs cost consent and the private tester access code.');return;}
  setBusy(true);
  try{
   const r=await api.post('/api/model-test',{mode:selected,prompt:prompt.trim(),approved:frontier&&approved,accessCode:frontier?accessCode:undefined});
   const v=r.data as Result;
   if(!v?.answer||!v?.model)throw Error('No validated response');
   setResults(old=>({...old,[selected]:v}));
   setStatus('Genuine response received from '+v.provider+' / '+v.model+'.');
  }catch(ex){const msg=ex instanceof Error?ex.message:'The provider call failed';setError('Test unsuccessful: '+msg);}
  finally{setBusy(false);}
 }
 return <div className="lab-page inner-page">
  <div className="lab-heading"><span className="section-overline"><FlaskConical size={15}/> MUSITU ATLAS / MODEL EVALUATION</span><h1>Intelligence.<br/><em>Purpose-selected.</em></h1><p>Skip our own model shootout. Choose a model using source-attributed official benchmark evidence for your task, then work with that model directly. Published results are not guarantees.</p></div>
  <section className="official-route" aria-label="Official benchmark model recommendations"><div className="lab-panel-head"><div><span className="section-overline">PUBLISHED EVIDENCE / MODEL ROUTING</span><h2>Use the right model. Get to work.</h2></div><span className="lab-count">Official sources · 20 Oct 2026</span></div><p className="official-caveat">Benchmarks have different evaluation harnesses, effort levels and reporting publishers. These task assignments are MUSITU routing judgments based on cited releases, not independently validated model rankings.</p>{routingError&&<p role="alert">{routingError}</p>}<div className="official-picks">{officialPicks.map(p=><article className="official-pick" key={p.task}><span className="official-task">{p.title}</span><h3>{p.label}</h3><p>{p.why}</p><small>{p.officialEvidence}</small><div className="official-pick-actions"><a href={p.source} target="_blank" rel="noreferrer noopener">Source: {p.sourcePublisher} ↗</a><button type="button" disabled={!p.available} onClick={()=>onChoose(p.model)}>{p.available?"Use in AI Assistant →":"Requires provider setup"}</button></div></article>)}</div></section>
  <div className="lab-promise"><div><ShieldCheck size={24}/></div><p><strong>Paid inference does not begin automatically.</strong> Each premium request requires administrator-provided API access, a private tester code and explicit consent. The code stays in memory until this page is closed. The official-recommendation playbook itself makes zero AI requests and costs nothing. Only a deliberate Run button invokes a model.</p></div>
  <div className="lab-panel"><div className="lab-panel-head"><div><span className="section-overline">01 / PROVIDER READINESS</span><h2>Manual model selection (optional)</h2></div><span className="lab-count">{catalog.filter(v=>v.available).length} / {catalog.length||6} configured</span></div>
    <div className="lab-models">{catalog.length?catalog.map(m=><button type="button" key={m.id} onClick={()=>{setSelected(m.id);setApproved(false);setError('');}} className={'lab-model '+(selected===m.id?'selected ':'')+(m.available?'enabled':'unconfigured')} aria-pressed={selected===m.id}><div className="lab-model-title"><span>{m.label}</span><span className="lab-model-radio"/></div><small>{m.provider} · {m.tier==='frontier'?'FRONTIER':m.tier==='free'?'FREE ROUTE':'SANDBOX'}</small><span className={'lab-model-status '+(m.available?'model-yes':'model-no')}>{m.available?<><CheckCircle2 size={13}/> CONFIGURED</>:<><LockKeyhole size={13}/> NOT CONFIGURED</>}</span></button>):<p className="lab-loading">Checking provider configurations…</p>}</div>
    <div className="lab-provider-info"><Signal size={17}/><p>Configuration status is not proof that a key has API credits or access to every model. Only a completed request proves runtime availability.</p></div>
  </div>
  <div className="lab-grid"><form className="lab-panel lab-form" onSubmit={run}><span className="section-overline">02 / OPTIONAL LIVE TEST</span><h2>Test only when needed</h2><label htmlFor="lab-prompt">Identical test prompt</label><textarea id="lab-prompt" value={prompt} onChange={e=>setPrompt(e.target.value.slice(0,420))} minLength={12} maxLength={420} rows={5} placeholder="Enter a fair, self-contained test question…"/><div className="lab-form-bottom"><span>{prompt.length} / 420 characters</span><span>1 model per run</span></div>
   {frontier&&<div className="lab-auth"><div><KeyRound size={18}/><strong>Private premium testing</strong></div><label htmlFor="lab-access">Tester access code (never saved)</label><input id="lab-access" type="password" autoComplete="off" value={accessCode} onChange={e=>setAccessCode(e.target.value.slice(0,200))} placeholder="Enter the secret configured in Vercel"/><label className="lab-confirm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> I authorize this single provider request, which may incur API charges.</label></div>}
   <button type="submit" className="lab-run" disabled={busy||!enabled||prompt.trim().length<12||(Boolean(frontier)&&(!approved||accessCode.length===0))}>{busy?<><Clock3 size={18}/> Running live comparison…</>:<><Play size={17}/> Run {model?.label||'selected model'} <ArrowUpRight size={16}/></>}</button>
   {!enabled&&<p className="lab-unavailable">This model cannot be tested until its provider API key and testing gate have been configured. The website will not fabricate output.</p>}
   {error&&<p className="lab-error" role="alert"><AlertTriangle size={16}/>{error}</p>}{status&&<p className="lab-success" role="status"><CheckCircle2 size={16}/>{status}</p>}
  </form><div className="lab-panel lab-brief"><span className="section-overline">03 / EVALUATION STANDARD</span><h2>What we actually measure.</h2><div className="lab-check"><span>01</span><div><strong>Correctness</strong><p>Are facts and conclusions accurate? Review the output against the evidence you have.</p></div></div><div className="lab-check"><span>02</span><div><strong>Decision usefulness</strong><p>Does the answer materially improve a decision or produce a viable plan?</p></div></div><div className="lab-check"><span>03</span><div><strong>Execution readiness</strong><p>Are steps specific, testable, and honest about dependencies and limitations?</p></div></div><div className="lab-check"><span>04</span><div><strong>Latency & reliability</strong><p>Observe genuine response times and failures. Speed is not a proxy for intelligence.</p></div></div></div></div>
  <section className="lab-results"><div className="lab-panel-head"><div><span className="section-overline">LIVE TEST RESULTS</span><h2>Side-by-side evidence</h2></div><span className="lab-count">{Object.keys(results).length} model(s) tested</span></div>{Object.keys(results).length?
    <div className="lab-result-grid">{Object.entries(results).map(([id,r])=><article key={id} className="lab-result">
      <div className="lab-result-head"><span>{catalog.find(m=>m.id===id)?.label||r.model}</span><span>{r.provider}</span></div>
      <div className="lab-metrics">
        <span><Clock3 size={14}/> {r.latencyMs.toLocaleString()} ms</span>
        <span>{r.answerWords} words</span>
        <span>{typeof r.providerCostUsd==='number' ? ('$'+r.providerCostUsd.toFixed(6)+' gateway cost') : 'Cost not reported'}</span>
      </div>
      <div className="lab-result-text">{r.answer}</div>
      <small>Measured {new Date(r.measuredAt).toLocaleString()} · Live provider reply. Independently evaluate quality before trusting outcomes.</small>
    </article>)}</div>
    :<div className="lab-zero"><Sparkles size={30}/><h3>We measure, then we claim.</h3><p>Run the same prompt against configured models. Successful responses appear here for direct inspection.</p></div>}
  </section><p className="lab-privacy"><ShieldCheck size={16}/> Test results are held only in current-page memory. This lab does not run a hidden multi-model batch. Provider service fees may apply when using frontier APIs.</p>
 </div>;
}
