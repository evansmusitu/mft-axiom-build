import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, Command, FileText, LayoutDashboard, Radar, Search, Settings2, Target, Workflow, X } from 'lucide-react';
import { readMissions } from './missionStore';
type Page = 'overview'|'missions'|'assistant'|'workflows'|'insights'|'settings';
type Props={onClose:()=>void;onNavigate:(page:Page)=>void;runTitles:string[]};
const pages:{name:string;page:Page;icon:typeof Search}[]=[
  {name:'Overview dashboard',page:'overview',icon:LayoutDashboard},
  {name:'Mission Control',page:'missions',icon:Target},
  {name:'AI Assistant',page:'assistant',icon:Bot},
  {name:'AI Workflows',page:'workflows',icon:Workflow},
  {name:'Live intelligence',page:'insights',icon:Radar},
  {name:'Preferences',page:'settings',icon:Settings2}
];
export default function CommandPalette({onClose,onNavigate,runTitles}:Props){
  const [query,setQuery]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{input.current?.focus();function esc(e:KeyboardEvent){if(e.key==='Escape')onClose();}document.addEventListener('keydown',esc);return()=>document.removeEventListener('keydown',esc);},[onClose]);
  const results=useMemo(()=>{
    const q=query.trim().toLowerCase();
    const missions=readMissions().map(m=>({name:'Mission: '+m.title,page:'missions' as Page,icon:Target}));
    const past=runTitles.slice(0,7).map(t=>({name:'Workflow result: '+t,page:'workflows' as Page,icon:FileText}));
    return [...pages,...missions,...past].filter(x=>x.name.toLowerCase().includes(q)).slice(0,12);
  },[query,runTitles]);
  return <div className="palette-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="palette-box" role="dialog" aria-modal="true" aria-labelledby="palette-title">
      <div className="palette-search"><Search size={20}/><label htmlFor="palette-search" id="palette-title" className="sr-only">Search workspace commands</label><input id="palette-search" ref={input} autoComplete="off" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search pages, missions, and activity..." onKeyDown={e=>{if(e.key==='Enter'&&results.length)onNavigate(results[0].page);}}/><button type="button" onClick={onClose} aria-label="Close search"><X size={17}/></button></div>
      <div className="palette-list"><div className="palette-label">GO TO / {results.length} RESULTS</div>{results.length===0?<p className="palette-empty">No matches. Try searching for a page or mission.</p>:results.map((entry,i)=>{const Icon=entry.icon;return <button type="button" className="palette-item" key={entry.page+entry.name+i} onClick={()=>onNavigate(entry.page)}><Icon size={17}/><span>{entry.name}</span><ArrowRight size={16}/></button>})}</div><div className="palette-footer"><span><b>↵</b> Open first result</span><span><b>ESC</b> Close</span><span><Command size={12} style={{display:'inline'}}/> K to open</span></div>
    </div>
  </div>;
}