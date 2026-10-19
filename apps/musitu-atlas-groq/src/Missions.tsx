import { useState, useEffect } from 'react';
import { api } from './lib/client';
import { ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, Clock3, Download, FileText, Flag, Lightbulb, Plus, Rocket, RotateCcw, ShieldCheck, Sparkles, Target, Trash2, WandSparkles } from 'lucide-react';
import { Mission, Milestone, newId, readMissions, storeMissions, missionProgress, summarizeMissions } from './missionStore';
import './missions.css';

type Props = { focus:string; onAsk:(question:string)=>void; onChange:(count:number)=>void };
const starter = [
  { title:'Define the outcome',detail:'Write down what success looks like and who benefits.',success:'A clear one-sentence measurable outcome.' },
  { title:'Validate the core assumption',detail:'Speak to real stakeholders or test the smallest possible version.',success:'At least one piece of direct evidence.' },
  { title:'Build the smallest useful version',detail:'Create a concrete deliverable with a constrained scope.',success:'Something functional you can demonstrate.' },
  { title:'Review and improve',detail:'Collect feedback, compare it to your desired outcome, and choose the next iteration.',success:'Documented learning and next step.' }
];
const shortDate=(s:string)=>{const d=new Date(s);return isNaN(d.getTime())?'Recent':new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(d);};
const sanitize=(s:string,length:number)=>s.trim().slice(0,length);
function asMilestone(s:{title:string;detail:string;success:string}):Milestone{
  return {id:newId(),title:sanitize(s.title,110),detail:sanitize(s.detail,350),success:sanitize(s.success,200),status:'todo',evidence:''};
}
function download(name:string,data:string,type:string){
  const blob=new Blob([data],{type});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
export default function MissionStudio({focus,onAsk,onChange}:Props){
  const [items,setItems]=useState<Mission[]>(readMissions);
  const [goal,setGoal]=useState('');
  const [background,setBackground]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [active,setActive]=useState<string>(()=>readMissions()[0]?.id||'');
  const [banner,setBanner]=useState('');
  const [editing,setEditing]=useState<string|null>(null);
  useEffect(()=>{const ok=storeMissions(items);onChange(items.length);if(!ok)setBanner('Local storage is unavailable. Export your mission to retain it.');},[items,onChange]);
  const selected=items.find(m=>m.id===active)||items[0]||null;
  const summary=summarizeMissions(items);
  const done=selected?.steps.filter(s=>s.status==='done').length||0;
  const percentage=selected?missionProgress(selected):0;
  function create(data:{title:string;summary:string;steps:{title:string;detail:string;success:string}[]},origin:'ai'|'manual'){
    const m:Mission={id:newId(),goal:sanitize(goal,250),title:sanitize(data.title,100)||'New mission',
      summary:sanitize(data.summary,350),origin,createdAt:new Date().toISOString(),
      steps:data.steps.slice(0,8).map(asMilestone)};
    if(!m.steps.length){setError('No actionable milestones were generated.');return;}
    setItems(old=>[m,...old].slice(0,30));
    setActive(m.id);setError('');setGoal('');setBackground('');setBanner(origin==='ai'?'AI mission ready. You decide when work is actually done.':'Starter mission created. Customize it as you go.');
    setEditing(null);
  }
  async function generate(e:React.FormEvent){
    e.preventDefault();
    const value=sanitize(goal,250);
    if(value.length<10||busy){setError('Describe a specific goal in at least 10 characters.');return;}
    setError('');setBusy(true);setBanner('');
    try{
      const res=await api.post('/api/mission/plan',{goal:value,background:sanitize(background,600),focus});
      const data=res.data;
      if(!data||!Array.isArray(data.steps)||!data.steps.length)throw new Error('No steps');
      create({title:String(data.title||value),summary:String(data.summary||''),steps:data.steps},'ai');
    }catch{
      setError('AI planning is temporarily unavailable. Your goal has been kept — choose Quick start to create an editable mission now.');
    }finally{setBusy(false);}
  }
  function quickStart(){
    const value=sanitize(goal,250);
    if(value.length<10){setError('Describe a specific goal in at least 10 characters.');return;}
    create({title:value,summary:'An editable four-stage starter mission. No AI or external action was used.',steps:starter},'manual');
  }
  function changeStep(id:string,patch:Partial<Milestone>){
    if(!selected)return;
    setItems(old=>old.map(m=>m.id===selected.id?{...m,steps:m.steps.map(s=>s.id===id?{...s,...patch}:s)}:m));
  }
  function removeMission(){
    if(!selected||!window.confirm('Delete this mission and all its milestone notes from this browser?'))return;
    const rest=items.filter(m=>m.id!==selected.id);setItems(rest);setActive(rest[0]?.id||'');setBanner('Mission deleted from this device.');
  }
  function addStep(){
    if(!selected||selected.steps.length>=12)return;
    const step:Milestone={id:newId(),title:'New milestone',detail:'Describe the next action.',success:'Define how you will know it is finished.',status:'todo',evidence:''};
    setItems(old=>old.map(m=>m.id===selected.id?{...m,steps:[...m.steps,step]}:m));
    setEditing(step.id);setBanner('Milestone added.');
  }
  function exportMission(){
    if(!selected)return;
    const lines=['# '+selected.title,'','Goal: '+selected.goal,'',selected.summary,'','Progress: '+percentage+'%',''];
    selected.steps.forEach((s,i)=>{lines.push('## '+(i+1)+'. '+s.title+' ['+s.status.toUpperCase()+']','',s.detail,'','Definition of done: '+s.success,'','Evidence note: '+(s.evidence||'Not added'),'');});
    download('atlas-mission-'+selected.id.slice(0,7)+'.md',lines.join('\n'),'text/markdown');
    setBanner('Mission exported as Markdown.');
  }
  return <div className="mission-page inner-page">
    <div className="mission-eyebrow"><span className="mission-light"/> MUSITU ATLAS / MISSION INTELLIGENCE <span>V2.0</span></div>
    <section className="mission-intro"><div><span className="section-overline">MAKE AN AMBITION EXECUTABLE</span><h1>Give your vision<br/><em>a flight plan.</em></h1><p>Turn a meaningful goal into actionable milestones, track what you really finish, and capture the evidence behind every win.</p><div className="mission-chips"><span><Sparkles size={14}/> AI-assisted planning</span><span><Target size={14}/> Measurable progress</span><span><ShieldCheck size={14}/> Self-reported evidence</span></div></div><div className="mission-dial" aria-label="Your portfolio of missions"><div className="dial-outer"><div className="dial-inner"><span>MISSIONS</span><strong>{summary.total.toString().padStart(2,'0')}</strong><small>{summary.complete} completed</small></div></div><div className="dial-top">YOUR EXECUTION INDEX ↗</div></div></section>
    <div className="mission-workspace-grid">
      <section className="mission-creator" aria-labelledby="missionCreatorTitle"><div className="creator-title"><div className="creator-icon"><WandSparkles size={21}/></div><div><span className="section-overline">01 / DEFINE YOUR NEXT MOVE</span><h2 id="missionCreatorTitle">Start a new mission</h2></div></div>
        <form onSubmit={generate}><label className="m-field" htmlFor="mission-goal">What outcome are you working toward?<span>Be specific: what, for whom, and why it matters.</span></label><textarea id="mission-goal" maxLength={250} rows={3} value={goal} onChange={e=>setGoal(e.target.value)} placeholder="e.g. Launch a premium website that converts visitors into qualified leads"/><label className="m-field m-field-secondary" htmlFor="mission-context">Context or constraints <i>(optional)</i></label><textarea id="mission-context" rows={2} maxLength={600} value={background} onChange={e=>setBackground(e.target.value)} placeholder="Budget, deadline, customers, tools, or anything else worth knowing..."/><div className="m-controls"><button className="m-ai-btn" type="submit" disabled={goal.trim().length<10||busy}>{busy?<><RotateCcw className="spin" size={17}/> Designing mission...</>:<><Sparkles size={18}/> Generate with AI <ArrowUpRight size={16}/></>}</button><button className="m-secondary-btn" type="button" onClick={quickStart} disabled={goal.trim().length<10||busy}><Plus size={17}/> Quick start</button></div></form><p className="m-fine">AI generates a suggested plan, not completed work. Quick start creates an offline editable template.</p>{error&&<div role="alert" className="m-alert">{error}</div>}</section>
      <div className="mission-summary-panel"><span className="section-overline">02 / YOUR MOMENTUM</span><h3>Progress compounds.</h3><div className="m-summary-stat"><span>ACTIVE MISSIONS</span><strong>{summary.total-summary.complete}</strong></div><div className="m-summary-stat"><span>MILESTONES COMPLETED</span><strong>{summary.stepsDone}</strong></div><div className="m-summary-stat last"><span>FINISHED MISSIONS</span><strong>{summary.complete}</strong></div><div className="m-summary-note"><Lightbulb size={17}/><p>It's not about checking boxes. It's about creating proof that meaningful progress happened.</p></div></div>
    </div>
    <div className="mission-section-heading"><div><span className="section-overline">YOUR MISSION BOARD</span><h2>{items.length?'The work ahead.':'Ready for what comes next.'}</h2></div><span className="mission-count">{items.length} / 30 missions</span></div>
    {selected?<section className="mission-board" aria-label="Mission task board">
      <div className="mission-selector" aria-label="Select a mission">{items.map(m=><button key={m.id} type="button" className={selected.id===m.id?'chosen':''} onClick={()=>{setActive(m.id);setEditing(null);}}>{m.title.slice(0,35)}{m.title.length>35?'…':''}<span>{missionProgress(m)}%</span></button>)}</div>
      <div className="m-board-main"><div className="m-board-heading"><div><div className="m-board-kicker"><Flag size={14}/> {selected.origin==='ai'?'AI-SUGGESTED PLAN':'QUICK-START PLAN'} <span>·</span> CREATED {shortDate(selected.createdAt).toUpperCase()}</div><h3>{selected.title}</h3><p>{selected.summary}</p></div><div className="m-progress-ring" style={{'--progress':percentage+'%'} as React.CSSProperties}><div><strong>{percentage}%</strong><small>COMPLETE</small></div></div></div>
      <div className="m-track-meta"><span>{done} of {selected.steps.length} milestones completed</span><span>Manually tracked · saved on this device</span></div><div className="m-progress-line"><span style={{width:percentage+'%'}}/></div>
      <div className="m-board-columns"><div className="m-board-column"><span className="m-column-kicker"><span className="m-color-dot todo"/> NOT STARTED · {selected.steps.filter(s=>s.status==='todo').length}</span>{selected.steps.filter(s=>s.status==='todo').map((s)=>renderStep(s))}</div><div className="m-board-column"><span className="m-column-kicker"><span className="m-color-dot doing"/> IN PROGRESS · {selected.steps.filter(s=>s.status==='doing').length}</span>{selected.steps.filter(s=>s.status==='doing').map((s)=>renderStep(s))}</div><div className="m-board-column"><span className="m-column-kicker"><span className="m-color-dot done"/> COMPLETED · {done}</span>{selected.steps.filter(s=>s.status==='done').map((s)=>renderStep(s))}</div></div>
      <div className="m-board-actions"><button type="button" className="m-secondary-btn" disabled={selected.steps.length>=12} onClick={addStep}><Plus size={16}/> Add milestone</button><button type="button" className="m-secondary-btn" onClick={()=>onAsk('Help me improve this mission plan: '+selected.goal)}><Sparkles size={16}/> Discuss with AI</button><button type="button" className="m-secondary-btn" onClick={exportMission}><Download size={16}/> Export plan</button><button type="button" className="m-destructive" onClick={removeMission}><Trash2 size={16}/> Delete mission</button></div>
    </div></section>:<section className="m-empty"><div className="m-empty-illustration"><Rocket size={42}/></div><h3>Every extraordinary outcome starts somewhere.</h3><p>Define your goal above. Generate a tailored AI flight plan or start with an editable template. Your board will appear here.</p><div className="m-empty-line"><span/><span/><span/></div></section>}
    {banner&&<p className="m-success" role="status"><CheckCircle2 size={17}/>{banner}<button type="button" onClick={()=>setBanner('')} aria-label="Dismiss message">×</button></p>}
    <div className="m-privacy"><ShieldCheck size={17}/><span>Workspace information is stored only in this browser. AI-generated plans are suggestions, not automated execution. No other services or accounts are connected.</span></div>
  </div>;
  function renderStep(s:Milestone) {
    return <article className={'m-task m-task-'+s.status} key={s.id}><div className="m-task-header"><span className="m-task-bullet">{s.status==='done'?<Check size={14}/>:s.status==='doing'?<Clock3 size={14}/>:<Flag size={14}/>}</span><span className="m-task-status">{s.status==='todo'?'READY':s.status==='doing'?'IN MOTION':'COMPLETE'}</span></div>{editing===s.id?<div className="m-task-edit"><label>Title<input aria-label="Milestone title" maxLength={110} value={s.title} onChange={e=>changeStep(s.id,{title:e.target.value})}/></label><label>Action<textarea aria-label="Milestone description" maxLength={350} value={s.detail} onChange={e=>changeStep(s.id,{detail:e.target.value})}/></label><label>Definition of done<textarea aria-label="Milestone success criteria" maxLength={200} value={s.success} onChange={e=>changeStep(s.id,{success:e.target.value})}/></label><button type="button" onClick={()=>setEditing(null)}>Done editing <Check size={15}/></button></div>:<><h4>{s.title}</h4><p>{s.detail}</p><div className="m-done-definition"><span>DEFINITION OF DONE</span>{s.success}</div></>}
      <label className="m-step-label" htmlFor={'status-'+s.id}>STATUS</label><select id={'status-'+s.id} aria-label={'Status for '+s.title} value={s.status} onChange={e=>changeStep(s.id,{status:e.target.value as Milestone['status']})}><option value="todo">Not started</option><option value="doing">In progress</option><option value="done">Completed</option></select>
      <label className="m-step-label" htmlFor={'evidence-'+s.id}>EVIDENCE NOTE <span>(optional)</span></label><textarea id={'evidence-'+s.id} rows={2} maxLength={500} value={s.evidence} onChange={e=>changeStep(s.id,{evidence:e.target.value})} placeholder="A link, result or note about what you did..."/><button className="m-edit-action" type="button" onClick={()=>setEditing(editing===s.id?null:s.id)}>{editing===s.id?'Close editor':'Edit milestone'} <ArrowRight size={14}/></button>
    </article>;
  }
}