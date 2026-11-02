const QUALITY_BOUNDARY='INTERNAL_HEURISTIC_NOT_EXTERNALLY_CALIBRATED';
const CONTRADICTION_SEARCH_MODE='EXPLICIT_GRAPH_STANCE_SEARCH_NOT_SEMANTIC_NLI';
const clone=v=>structuredClone(v);
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
async function sha(v){const bytes=new TextEncoder().encode(typeof v==='string'?v:canonical(v));const d=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const done=tx=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('transaction aborted'));});
function unit(value,name){const n=Number(value);if(!Number.isFinite(n)||n<0||n>1)throw new TypeError(`${name} must be between 0 and 1`);return n;}
function scoreSourceQuality(profile){
  const values=['recency','domain_authority','methodological_transparency','conflict_of_interest_risk'].map(k=>unit(profile[k],k));
  const [recency,authority,transparency,conflict]=values;
  const score=.20*Number(Boolean(profile.primary))+.15*Number(Boolean(profile.independently_verifiable))+.15*recency+.25*authority+.25*transparency-.20*conflict;
  return Math.max(0,Math.min(1,score));
}
function recencyFromFreshness(freshness){const ttl=Number(freshness?.ttl_seconds);const age=Math.max(0,Number(freshness?.age_seconds)||0);if(!Number.isFinite(ttl)||ttl<=0)return 0;return Math.max(0,Math.min(1,1-age/ttl));}
function injectQualityControls(){
  const form=document.querySelector('#research-source-form');if(!form||document.querySelector('#research-quality-controls'))return;
  const field=document.createElement('fieldset');field.id='research-quality-controls';field.className='research-quality-controls';
  const legend=document.createElement('legend');legend.textContent='Source quality · internal heuristic';
  const boundary=document.createElement('p');boundary.className='field-hint';boundary.textContent='Not externally calibrated. Recency is derived from source as-of freshness; the remaining dimensions are explicit operator metadata.';
  const primary=document.createElement('label');primary.className='check-row';primary.innerHTML='<input id="research-quality-primary" type="checkbox"> Primary source';
  const verifiable=document.createElement('label');verifiable.className='check-row';verifiable.innerHTML='<input id="research-quality-verifiable" type="checkbox"> Independently verifiable';
  const authority=document.createElement('label');authority.textContent='Domain authority';const ai=document.createElement('input');ai.id='research-quality-authority';ai.type='number';ai.min='0';ai.max='1';ai.step='0.01';ai.value='0';authority.append(ai);
  const transparency=document.createElement('label');transparency.textContent='Methodological transparency';const ti=document.createElement('input');ti.id='research-quality-transparency';ti.type='number';ti.min='0';ti.max='1';ti.step='0.01';ti.value='0';transparency.append(ti);
  const conflict=document.createElement('label');conflict.textContent='Conflict-of-interest risk';const ci=document.createElement('input');ci.id='research-quality-conflict';ci.type='number';ci.min='0';ci.max='1';ci.step='0.01';ci.value='0';conflict.append(ci);
  field.append(legend,boundary,primary,verifiable,authority,transparency,conflict);
  form.querySelector('button[type=submit]').before(field);
}
function readQualityProfile(row,payload={}){
  const supplied=payload.qualityProfile||null;
  const profile=supplied?{...supplied}:{
    primary:document.querySelector('#research-quality-primary')?.checked||false,
    independently_verifiable:document.querySelector('#research-quality-verifiable')?.checked||false,
    domain_authority:document.querySelector('#research-quality-authority')?.value??0,
    methodological_transparency:document.querySelector('#research-quality-transparency')?.value??0,
    conflict_of_interest_risk:document.querySelector('#research-quality-conflict')?.value??0,
  };
  profile.primary=Boolean(profile.primary);profile.independently_verifiable=Boolean(profile.independently_verifiable);
  profile.recency=profile.recency===undefined?recencyFromFreshness(row?.freshness):unit(profile.recency,'recency');
  profile.domain_authority=unit(profile.domain_authority,'domain_authority');
  profile.methodological_transparency=unit(profile.methodological_transparency,'methodological_transparency');
  profile.conflict_of_interest_risk=unit(profile.conflict_of_interest_risk,'conflict_of_interest_risk');
  return profile;
}
function injectQualityPanel(){
  const space=document.querySelector('#research-space'),results=space?.querySelector('.research-results');if(!space||!results||document.querySelector('#research-quality-panel'))return;
  const panel=document.createElement('section');panel.id='research-quality-panel';panel.className='research-card research-quality-panel';panel.setAttribute('aria-labelledby','research-quality-title');
  const heading=document.createElement('div');heading.className='section-heading';const wrap=document.createElement('div');const eye=document.createElement('span');eye.className='eyebrow';eye.textContent='Blueprint completeness';const h=document.createElement('h3');h.id='research-quality-title';h.textContent='Source quality + contradiction search';wrap.append(eye,h);const button=document.createElement('button');button.id='research-contradiction-search';button.type='button';button.className='button secondary';button.textContent='Search explicit contradictions';heading.append(wrap,button);
  const boundary=document.createElement('p');boundary.id='research-quality-boundary';boundary.className='boundary-note';boundary.textContent='Source-quality scores are internal deterministic heuristics, not externally calibrated. Contradiction search returns only explicitly bound contradicting citation stances; it does not claim semantic/NLI contradiction discovery.';
  const quality=document.createElement('div');quality.id='research-source-quality-list';quality.setAttribute('aria-live','polite');const contradictions=document.createElement('div');contradictions.id='research-contradiction-results';contradictions.setAttribute('aria-live','polite');panel.append(heading,boundary,quality,contradictions);results.before(panel);
}
function item(tag,text,cls=''){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=text;return el;}

export async function enhanceResearchWorkspace({emit=()=>{},research}={}){
  if(!research?.store)throw new TypeError('qualified Research substrate required');
  const store=research.store;injectQualityControls();injectQualityPanel();
  const originalAddSource=store.addSource.bind(store),originalVerify=store.verify.bind(store),originalSnapshot=store.snapshot.bind(store);
  async function persistSource(row){const tx=store.db.transaction('sources','readwrite');tx.objectStore('sources').put(clone(row));await done(tx);}
  store.addSource=async(projects,actor,payload,controls)=>{
    const provisional={freshness:{ttl_seconds:1,age_seconds:0}};const explicit=payload?.qualityProfile;
    if(explicit)readQualityProfile(provisional,payload);
    else {
      unit(document.querySelector('#research-quality-authority')?.value??0,'domain_authority');
      unit(document.querySelector('#research-quality-transparency')?.value??0,'methodological_transparency');
      unit(document.querySelector('#research-quality-conflict')?.value??0,'conflict_of_interest_risk');
    }
    const row=await originalAddSource(projects,actor,payload,controls);const profile=readQualityProfile(row,payload);const score=scoreSourceQuality(profile);
    row.source_quality={schema:'musitu.axiom.source-quality.browser.v1',scorer:'AXIOM_SOURCE_QUALITY_HEURISTIC_V1',calibration_boundary:QUALITY_BOUNDARY,profile:{source_id:row.source_id,...profile},score};
    await persistSource(row);await store.event(row.project_id,'research.source.quality',{source_id:row.source_id,score,calibration_boundary:QUALITY_BOUNDARY});emit('research.source-quality',{state:'internal-heuristic-not-calibrated'});return clone(row);
  };
  store.verify=async projectId=>{
    const result=await originalVerify(projectId),sources=await store.all('sources',projectId),claims=await store.all('claims',projectId),citations=await store.all('citations',projectId),errors=[...result.errors];
    const bySource=new Map(sources.map(s=>[s.source_id,s]));
    for(const source of sources){const q=source.source_quality;if(!q)continue;try{const p=q.profile||{};const expected=scoreSourceQuality(p);if(q.calibration_boundary!==QUALITY_BOUNDARY)errors.push(`source_quality_boundary:${source.source_id}`);if(typeof q.score!=='number'||Math.abs(q.score-expected)>1e-12)errors.push(`source_quality_score:${source.source_id}`);}catch{errors.push(`source_quality_profile:${source.source_id}`);}}
    for(const claim of claims){if(!claim.material)continue;for(const cite of citations.filter(c=>c.claim_id===claim.claim_id)){if(!bySource.get(cite.source_id)?.source_quality)errors.push(`source_quality_missing:${claim.claim_id}:${cite.source_id}`);}}
    result.source_quality_boundary=QUALITY_BOUNDARY;result.contradiction_search_mode=CONTRADICTION_SEARCH_MODE;result.errors=[...new Set(errors)].sort();result.status=result.errors.length?'FAIL':'PASS';delete result.integrity_sha256;result.integrity_sha256=await sha(result);return result;
  };
  store.searchContradictions=async(projectId,claimId='')=>{const [citations,sources]=await Promise.all([store.all('citations',projectId),store.all('sources',projectId)]),bySource=new Map(sources.map(s=>[s.source_id,s]));const rows=citations.filter(c=>c.stance==='contradicts'&&(!claimId||c.claim_id===claimId)).sort((a,b)=>a.claim_id.localeCompare(b.claim_id)||a.citation_id.localeCompare(b.citation_id)).map(c=>({claim_id:c.claim_id,citation_id:c.citation_id,source_id:c.source_id,quote:c.quote,source_quality:bySource.get(c.source_id)?.source_quality||null,freshness:bySource.get(c.source_id)?.freshness||null}));return {schema:'musitu.axiom.contradiction-search.browser.v1',project_id:projectId,claim_id:claimId||null,search_mode:CONTRADICTION_SEARCH_MODE,result_count:rows.length,results:rows};};
  store.snapshot=async projectId=>{const snap=await originalSnapshot(projectId),bySource=new Map(snap.sources.map(s=>[s.source_id,s]));for(const claim of snap.claims){claim.source_quality={calibration_boundary:QUALITY_BOUNDARY,supporting:claim.supporting_source_ids.map(source_id=>({source_id,quality:bySource.get(source_id)?.source_quality||null})),contradicting:claim.contradicting_source_ids.map(source_id=>({source_id,quality:bySource.get(source_id)?.source_quality||null}))};}snap.source_quality_boundary=QUALITY_BOUNDARY;snap.contradiction_search=await store.searchContradictions(projectId);return snap;};
  let rendering=false;
  async function renderExtension(){if(rendering)return;rendering=true;try{const quality=document.querySelector('#research-source-quality-list'),contradictions=document.querySelector('#research-contradiction-results'),projectId=research.getCurrentProjectId?.()||'';if(!quality||!contradictions)return;quality.replaceChildren();contradictions.replaceChildren();if(!projectId){quality.append(item('p','Choose a Project to inspect source quality.','proof-empty'));contradictions.append(item('p','No contradiction search yet.','proof-empty'));return;}const snap=await store.snapshot(projectId);quality.append(item('h4','Claim source quality'));for(const claim of snap.claims.filter(c=>c.material)){const row=item('p',`${claim.claim_id} · support ${claim.source_quality.supporting.map(x=>`${x.source_id}:${x.quality?x.quality.score.toFixed(3):'missing'}`).join(', ')||'missing'} · contradiction ${claim.source_quality.contradicting.map(x=>`${x.source_id}:${x.quality?x.quality.score.toFixed(3):'none'}`).join(', ')||'none'}`,'research-evidence-line');quality.append(row);}if(!snap.claims.some(c=>c.material))quality.append(item('p','No material claims yet.','proof-empty'));const search=snap.contradiction_search;contradictions.append(item('h4',`Explicit contradiction search · ${search.result_count} result${search.result_count===1?'':'s'}`));if(!search.results.length)contradictions.append(item('p','No explicitly bound contradicting citations.','proof-empty'));for(const hit of search.results)contradictions.append(item('p',`${hit.claim_id} ← ${hit.source_id} · “${hit.quote}”`,'research-evidence-line'));}finally{rendering=false;}}
  document.querySelector('#research-contradiction-search')?.addEventListener('click',()=>{renderExtension();emit('research.contradiction-search',{state:'explicit-graph-stance-search'});});
  const report=document.querySelector('#research-report');if(report){const observer=new MutationObserver(()=>void renderExtension());observer.observe(report,{childList:true,subtree:true});}
  await renderExtension();
  const api={QUALITY_BOUNDARY,CONTRADICTION_SEARCH_MODE,scoreSourceQuality,searchContradictions:store.searchContradictions.bind(store),refresh:renderExtension};window.AxiomResearchQuality=Object.freeze(api);return api;
}
