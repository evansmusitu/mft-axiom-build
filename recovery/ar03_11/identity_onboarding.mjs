import {clean, clone, ensureNoSecretLike, iso, requireText, seal, sha256, uniqueStrings, verifySeal} from './common.mjs';

export class IdentityOnboardingKernel {
  constructor({now=()=>new Date()}={}) { this.now=now; this.users=new Map(); this.organizations=new Map(); this.keys=new Map(); this.audit=[]; }
  async _audit(kind, actor, subject, detail={}) {
    ensureNoSecretLike(detail,'audit detail');
    const previous=this.audit.at(-1)?.sha256||null;
    const row=await seal('musitu.axiom.ar03.audit-event.v1',{sequence:this.audit.length,kind:clean(kind,80),actor_id:clean(actor,160),subject_id:clean(subject,160),detail:clone(detail),previous_event_sha256:previous,at:iso(this.now())});
    this.audit.push(row); return row;
  }
  async createOrganization({organization_id,name,owner_subject}) {
    organization_id=requireText(organization_id,'organization id'); owner_subject=requireText(owner_subject,'owner subject');
    if(this.organizations.has(organization_id)) throw new DOMException('organization exists','ConstraintError');
    const row=await seal('musitu.axiom.ar03.organization.v1',{organization_id,name:requireText(name,'organization name'),owner_subject,created_at:iso(this.now())});
    this.organizations.set(organization_id,row); await this._audit('organization.created',owner_subject,organization_id,{name:row.name}); return row;
  }
  async register({subject,display_name,organization_id,roles=['member'],entitlements=['axiom.safe.execute'],assurance='SERVER_SESSION'}) {
    subject=requireText(subject,'subject'); organization_id=requireText(organization_id,'organization id');
    if(!this.organizations.has(organization_id)) throw new DOMException('organization not found','NotFoundError');
    if(this.users.has(subject)) throw new DOMException('user exists','ConstraintError');
    const row=await seal('musitu.axiom.ar03.identity.v1',{subject,display_name:requireText(display_name,'display name'),organization_id,roles:uniqueStrings(roles),entitlements:uniqueStrings(entitlements),assurance:clean(assurance,80)||'SERVER_SESSION',status:'ACTIVE',created_at:iso(this.now()),recovery_version:0});
    this.users.set(subject,row); await this._audit('identity.registered',subject,subject,{organization_id,roles:row.roles,entitlements:row.entitlements}); return row;
  }
  async linkOAuth({subject,provider,provider_subject,scopes=[]}) {
    const user=this.users.get(requireText(subject,'subject')); if(!user) throw new DOMException('user not found','NotFoundError');
    const link=await seal('musitu.axiom.ar03.oauth-link.v1',{subject,provider:requireText(provider,'provider'),provider_subject:requireText(provider_subject,'provider subject'),scopes:uniqueStrings(scopes),linked_at:iso(this.now()),token_material_stored:false});
    await this._audit('oauth.linked',subject,subject,{provider:link.provider,scopes:link.scopes}); return link;
  }
  async registerKeyMetadata({subject,key_id,key_prefix,scopes=[],expires_at=null}) {
    const user=this.users.get(requireText(subject,'subject')); if(!user) throw new DOMException('user not found','NotFoundError');
    key_id=requireText(key_id,'key id'); if(this.keys.has(key_id)) throw new DOMException('key id exists','ConstraintError');
    const prefix=clean(key_prefix,24); if(!prefix) throw new TypeError('key prefix required');
    ensureNoSecretLike({key_id,prefix,scopes},'key metadata');
    const row=await seal('musitu.axiom.ar03.key-metadata.v1',{key_id,subject,key_prefix:prefix,scopes:uniqueStrings(scopes),expires_at:expires_at?iso(expires_at):null,status:'ACTIVE',secret_stored:false,created_at:iso(this.now())});
    this.keys.set(key_id,row); await this._audit('key.metadata_registered',subject,key_id,{scopes:row.scopes,expires_at:row.expires_at}); return row;
  }
  async recover({subject,recovery_actor,reason}) {
    const prior=this.users.get(requireText(subject,'subject')); if(!prior) throw new DOMException('user not found','NotFoundError');
    recovery_actor=requireText(recovery_actor,'recovery actor'); reason=requireText(reason,'recovery reason',240);
    const nextBody={...Object.fromEntries(Object.entries(prior).filter(([k])=>k!=='sha256'&&k!=='schema')),recovery_version:Number(prior.recovery_version||0)+1,recovered_at:iso(this.now())};
    const next=await seal('musitu.axiom.ar03.identity.v1',nextBody); this.users.set(subject,next);
    for(const [id,key] of this.keys){ if(key.subject===subject){ const body={...Object.fromEntries(Object.entries(key).filter(([k])=>!['sha256','schema'].includes(k))),status:'REVOKED_BY_RECOVERY',revoked_at:iso(this.now())}; this.keys.set(id,await seal('musitu.axiom.ar03.key-metadata.v1',body)); } }
    await this._audit('identity.recovered',recovery_actor,subject,{reason,recovery_version:next.recovery_version}); return next;
  }
  context(subject) {
    const user=this.users.get(clean(subject,160)); if(!user||user.status!=='ACTIVE') return null;
    return clone({subject:user.subject,display_name:user.display_name,organization_id:user.organization_id,roles:user.roles,entitlements:user.entitlements,assurance:user.assurance,authorization_source:'SERVER_ONLY',browser_may_grant:false});
  }
  entitled(subject,entitlement){const ctx=this.context(subject);return Boolean(ctx&&ctx.entitlements.includes(clean(entitlement,160)));}
  async verify() {
    const errors=[]; let previous=null;
    for(let i=0;i<this.audit.length;i++){const e=this.audit[i];if(!await verifySeal(e))errors.push(`audit_hash:${i}`);if(e.sequence!==i||e.previous_event_sha256!==previous)errors.push(`audit_chain:${i}`);previous=e.sha256;}
    for(const [id,row] of this.users) if(!await verifySeal(row)||id!==row.subject) errors.push(`identity:${id}`);
    for(const [id,row] of this.organizations) if(!await verifySeal(row)||id!==row.organization_id) errors.push(`organization:${id}`);
    for(const [id,row] of this.keys) if(!await verifySeal(row)||id!==row.key_id||row.secret_stored!==false) errors.push(`key:${id}`);
    return {status:errors.length?'FAIL':'PASS',errors:[...new Set(errors)].sort(),user_count:this.users.size,organization_count:this.organizations.size,key_count:this.keys.size,audit_event_count:this.audit.length};
  }
}

export async function runAr03Gate({identity,graph,orchestrator,subject,objective='calculate 40+2'}={}) {
  if(!identity?.context||!graph?.createProject||!orchestrator?.execute) throw new TypeError('AR-03 gate dependencies required');
  const ctx=identity.context(subject); if(!ctx) throw new DOMException('authenticated identity required','NotAllowedError');
  if(!identity.entitled(subject,'axiom.safe.execute')) throw new DOMException('safe execution entitlement missing','NotAllowedError');
  const project=await graph.createProject(ctx,{name:'AR-03 self-service project'});
  const result=await orchestrator.execute({identity:ctx,project_id:project.project_id,objective,risk_class:'S0'});
  const pass=result?.status==='COMPLETED'&&result?.manual_provisioning_required===false;
  return {schema:'musitu.axiom.ar03.gate.v1',status:pass?'PASS':'FAIL',new_customer_self_service:pass,project_id:project.project_id,task_id:result?.task_id||null,manual_provisioning_required:result?.manual_provisioning_required??true,production_mutated:false};
}
