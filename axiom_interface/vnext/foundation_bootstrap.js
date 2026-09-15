import {
  FA06_FOUNDATION_VERSION,
  AXIOM_OBJECT_TYPES,
  OBJECT_CONTRACTS,
  DESIGN_TOKENS,
  SHELL_SURFACES,
  FOUNDATION_ONLY_ROUTE_IDS,
  CLAIM_BOUNDARIES,
  validateAxiomObject,
  assertAxiomObject,
} from './foundation_contracts.js';
import {initIdentitySessionAdapter} from './identity_session_adapter.js';

const ROUTE_COPY=Object.freeze({
  memory:Object.freeze({
    title:'Knowledge / Memory',
    description:'Project-scoped knowledge, memory controls, provenance and retention belong here.',
    boundary:'FA-06 establishes the surface contract only. Durable cross-device memory execution remains gated by later qualification.'
  }),
  twin:Object.freeze({
    title:'Twin / Scenario Lab',
    description:'Counterfactuals, scenarios, digital twins and decision rehearsal without collapsing simulation into fact.',
    boundary:'Scenario execution and calibrated predictive claims remain gated by FA-14 evidence.'
  }),
  evidence:Object.freeze({
    title:'Evidence Observatory',
    description:'Inspect inputs, sources, capability chains, calculations, actions, policies, approvals, hashes, receipts and verification.',
    boundary:'This foundation view does not elevate missing evidence to PASS.'
  }),
  marketplace:Object.freeze({
    title:'Marketplace',
    description:'Governed discovery of skills, agents, connectors and capability packages.',
    boundary:'Registry presence is not implementation proof or certification.'
  }),
  enterprise:Object.freeze({
    title:'Enterprise Control Plane',
    description:'Tenant policy, identity, audit, budgets, deployment governance and organization controls.',
    boundary:'FA-06 exposes no tenant-admin mutation authority.'
  }),
  inbox:Object.freeze({
    title:'Inbox',
    description:'Human approvals, agent escalations, material-change notifications and completed outcome packages.',
    boundary:'No autonomous consequential action is inferred from an inbox item.'
  }),
});

function applyFoundationTokens(){
  const root=document.documentElement;
  const values={
    '--axiom-radius-sm':DESIGN_TOKENS.radius.sm,
    '--axiom-radius-md':DESIGN_TOKENS.radius.md,
    '--axiom-radius-lg':DESIGN_TOKENS.radius.lg,
    '--axiom-space-xs':DESIGN_TOKENS.spacing.xs,
    '--axiom-space-sm':DESIGN_TOKENS.spacing.sm,
    '--axiom-space-md':DESIGN_TOKENS.spacing.md,
    '--axiom-space-lg':DESIGN_TOKENS.spacing.lg,
    '--axiom-space-xl':DESIGN_TOKENS.spacing.xl,
    '--axiom-motion-fast':DESIGN_TOKENS.motion.fast,
    '--axiom-motion-standard':DESIGN_TOKENS.motion.standard,
  };
  for (const [name,value] of Object.entries(values)) root.style.setProperty(name,value);
  root.dataset.foundationVersion=FA06_FOUNDATION_VERSION;
}

function navContainerFor(surface){
  if (surface.group==='primary') return document.querySelector('.nav-rail nav:not(.nav-secondary)');
  return document.querySelector('.nav-secondary');
}

function ensureRouteLink(surface){
  if (surface.presentation!=='route' || document.querySelector(`[data-route="${surface.id}"]`)) return;
  const container=navContainerFor(surface);
  if (!container) return;
  const link=document.createElement('a');
  link.href=`#/${surface.id}`;
  link.dataset.route=surface.id;
  const glyph=document.createElement('span');
  glyph.setAttribute('aria-hidden','true');
  glyph.textContent=surface.id==='memory'?'◫':surface.id==='twin'?'◎':surface.id==='evidence'?'✓':surface.id==='marketplace'?'◈':surface.id==='enterprise'?'▥':'▱';
  const label=document.createElement('b');
  label.textContent=surface.label;
  link.append(glyph,label);
  container.append(link);
}

function renderFoundationOnlyRoute(route){
  if (!FOUNDATION_ONLY_ROUTE_IDS.includes(route)) return false;
  const root=document.querySelector('#workspace-root');
  if (!root) return false;
  const copy=ROUTE_COPY[route];
  if (!copy) return false;

  const section=document.createElement('section');
  section.className='section';
  section.dataset.foundationSurface=route;

  const header=document.createElement('header');
  header.className='page-head';
  const titleWrap=document.createElement('div');
  const eyebrow=document.createElement('small');
  eyebrow.className='eyebrow';
  eyebrow.textContent='MUSITU AXIOM · FOUNDATION CONTRACT';
  const title=document.createElement('h1');
  title.textContent=copy.title;
  const description=document.createElement('p');
  description.textContent=copy.description;
  titleWrap.append(eyebrow,title,description);
  header.append(titleWrap);

  const card=document.createElement('article');
  card.className='card';
  const state=document.createElement('small');
  state.className='eyebrow';
  state.textContent='FOUNDATION ONLY · BACKEND AUTHORITY NOT CLAIMED';
  const heading=document.createElement('h3');
  heading.textContent='Surface contract established';
  const boundary=document.createElement('p');
  boundary.textContent=copy.boundary;
  const phase=document.createElement('p');
  phase.className='muted';
  const surface=SHELL_SURFACES.find(item=>item.id===route);
  phase.textContent=`Implementation gate: ${surface?.phase||'later phase'} · current state: ${surface?.state||'FOUNDATION_ONLY'}.`;
  card.append(state,heading,boundary,phase);
  section.append(header,card);
  root.replaceChildren(section);

  document.querySelectorAll('[data-route]').forEach(link=>{
    if (link.dataset.route===route) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  const inspectorTitle=document.querySelector('#inspector-title');
  if (inspectorTitle) inspectorTitle.textContent='Context';
  const inspectorBody=document.querySelector('#inspector-body');
  if (inspectorBody) {
    inspectorBody.replaceChildren();
    const strong=document.createElement('strong');
    strong.textContent=copy.title;
    const p=document.createElement('p');
    p.className='muted';
    p.textContent=copy.boundary;
    inspectorBody.append(strong,p);
  }
  return true;
}

function currentRoute(){
  return (location.hash.match(/^#\/([^/?#]+)/)||[])[1]||'home';
}

function reconcileShell(){
  for (const surface of SHELL_SURFACES) ensureRouteLink(surface);
  queueMicrotask(()=>renderFoundationOnlyRoute(currentRoute()));
}

applyFoundationTokens();
reconcileShell();
window.addEventListener('hashchange',()=>queueMicrotask(()=>renderFoundationOnlyRoute(currentRoute())));

const identity=initIdentitySessionAdapter({
  emit:(type,detail)=>{
    try { window.dispatchEvent(new CustomEvent('axiom:foundation-event',{detail:{type,detail}})); } catch {}
  }
});

window.AxiomFinalProductFoundation=Object.freeze({
  version:FA06_FOUNDATION_VERSION,
  objectTypes:AXIOM_OBJECT_TYPES,
  objectContracts:OBJECT_CONTRACTS,
  shellSurfaces:SHELL_SURFACES,
  claimBoundaries:CLAIM_BOUNDARIES,
  validateAxiomObject,
  assertAxiomObject,
  identity,
});
