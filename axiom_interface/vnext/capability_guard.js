import {routeCapabilityV2, assertPlannerRouteAllowed, QUALIFICATION_CLASSES, CAPABILITY_TRUTH} from './capability_router_v2.js';

function renderCapabilityPolicyBlock(route){
  const root=document.querySelector('#workspace-root');
  if (!root) return;
  const section=document.createElement('section');
  section.className='section';
  section.dataset.capabilityPolicy='denied';
  const card=document.createElement('article');
  card.className='card';
  const eyebrow=document.createElement('small');
  eyebrow.className='eyebrow';
  eyebrow.textContent='CAPABILITY POLICY · FAIL CLOSED';
  const title=document.createElement('h3');
  title.textContent='This capability route is not authorized';
  const detail=document.createElement('p');
  detail.textContent=route.policy?.reason||'The requested capability has no execution authority.';
  const meta=document.createElement('p');
  meta.className='muted';
  meta.textContent=`Qualification: ${route.qualification_class} · browser execution: denied · external action: denied · production: denied.`;
  card.append(eyebrow,title,detail,meta);
  section.append(card);
  root.prepend(section);
}

export function installGovernedCapabilityGuard(){
  if (document.documentElement.dataset.capabilityGuardV2==='installed') return;
  document.documentElement.dataset.capabilityGuardV2='installed';
  document.addEventListener('submit',event=>{
    const form=event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const input=form.id==='hero-form'
      ? form.querySelector('#hero-input')
      : form.id==='composer'
        ? form.querySelector('#composer-input')
        : null;
    const objective=input?.value?.trim();
    if (!objective) return;
    const route=routeCapabilityV2(objective,{riskClass:'S0'});
    window.AxiomLastGovernedRoute=route;
    try {
      assertPlannerRouteAllowed(route);
    } catch {
      event.preventDefault();
      event.stopImmediatePropagation();
      queueMicrotask(()=>renderCapabilityPolicyBlock(route));
    }
  },true);
}

installGovernedCapabilityGuard();

window.AxiomCapabilityRouterV2=Object.freeze({
  route:routeCapabilityV2,
  assertAllowed:assertPlannerRouteAllowed,
  qualificationClasses:QUALIFICATION_CLASSES,
  truth:CAPABILITY_TRUTH,
});
