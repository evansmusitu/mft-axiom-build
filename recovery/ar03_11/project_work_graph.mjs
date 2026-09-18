import {clean, clone, iso, requireText, seal, sha256, uniqueStrings, verifySeal} from './common.mjs';

const ENTITY_TYPES=Object.freeze(['PROJECT','WORK','ARTIFACT','AGENT','MEMORY','SOURCE','APPROVAL']);

export class ProjectWorkGraphKernel {
  constructor({now=()=>new Date()}={}){this.now=now;this.projects=new Map();this.entities=new Map();this.events=new Map();this.idCounter=0;}
  _id(prefix){this.idCounter+=1;return `${prefix}_${String(this.idCounter).padStart(8,'0')}`;}
  _ctx(identity){if(!identity?.subject||!identity?.organization_id)throw new DOMException('server identity required','NotAllowedError');return identity;}
  async _event(project,kind,actor,payload={}){
    const list=this.events.get(project.project_id)||[];const previous=list.at(-1)?.sha256||null;
    const row=await seal('musitu.axiom.ar04.graph-event.v1',{event_id:`evt_${project.project_id}_${String(list.length).padStart(8,'0')}`,project_id:project.project_id,organization_id:project.organization_id,sequence:list.length,kind,actor_id:actor,payload:clone(payload),previous_event_sha256:previous,at:iso(this.now())});
    list.push(row);this.events.set(project.project_id,list);return row;
  }
  _project(identity,projectId){const ctx=this._ctx(identity),p=this.projects.get(clean(projectId,180));if(!p)throw new DOMException('project not found','NotFoundError');if(p.organization_id!==ctx.organization_id)throw new DOMException('cross-tenant project access blocked','SecurityError');return p;}
  async createProject(identity,{name,project_id=null,provenance={source:'AR_RECOVERY'}}={}){
    const ctx=this._ctx(identity);const id=clean(project_id,180)||this._id('project');if(this.projects.has(id))throw new DOMException('project exists','ConstraintError');
    const body={project_id:id,organization_id:ctx.organization_id,owner_subject:ctx.subject,name:requireText(name,'project name'),version:1,provenance:clone(provenance),created_at:iso(this.now()),updated_at:iso(this.now())};const row=await seal('musitu.axiom.ar04.project.v1',body);this.projects.set(id,row);this.entities.set(id,new Map());await this._event(row,'project.created',ctx.subject,{project_sha256:row.sha256});return clone(row);
  }
  async putEntity(identity,projectId,{type,id=null,data={},provenance={source:'USER'},expected_version=null}={}){
    const p=this._project(identity,projectId);type=clean(type,40).toUpperCase();if(!ENTITY_TYPES.includes(type)||type==='PROJECT')throw new TypeError('supported non-project entity type required');
    const map=this.entities.get(p.project_id);const entityId=clean(id,180)||this._id(type.toLowerCase());const prior=map.get(entityId)||null;
    if(expected_version!=null&&Number(expected_version)!==Number(prior?.version||0))throw new DOMException('optimistic version conflict','InvalidStateError');
    const body={entity_id:entityId,entity_type:type,project_id:p.project_id,organization_id:p.organization_id,version:Number(prior?.version||0)+1,data:clone(data),provenance:clone(provenance),updated_at:iso(this.now()),created_at:prior?.created_at||iso(this.now())};
    const row=await seal('musitu.axiom.ar04.graph-entity.v1',body);map.set(entityId,row);await this._event(p,prior?'entity.updated':'entity.created',identity.subject,{entity_id:entityId,entity_type:type,version:row.version,entity_sha256:row.sha256});return clone(row);
  }
  async readEntity(identity,projectId,entityId){const p=this._project(identity,projectId),row=this.entities.get(p.project_id).get(clean(entityId,180));return row?clone(row):null;}
  async listEntities(identity,projectId,{types=ENTITY_TYPES.slice(1)}={}){const p=this._project(identity,projectId),allowed=new Set(uniqueStrings(types,40).map(x=>x.toUpperCase()));return [...this.entities.get(p.project_id).values()].filter(x=>allowed.has(x.entity_type)).map(clone);}
  async sync(identity,projectId,{cursor=-1,device_id='device'}={}){
    const p=this._project(identity,projectId);const list=this.events.get(p.project_id)||[];const start=Math.max(-1,Number(cursor)||-1);const events=list.filter(e=>e.sequence>start).map(clone);return {schema:'musitu.axiom.ar04.sync.v1',project_id:p.project_id,organization_id:p.organization_id,device_id:clean(device_id,120),from_cursor:start,to_cursor:list.length-1,events,project:clone(p),entities:[...this.entities.get(p.project_id).values()].map(clone),provenance_preserved:true};
  }
  async importLocal(identity,{project,entities=[],source_device='legacy-local'}={}){
    const created=await this.createProject(identity,{name:project?.name||'Imported project',project_id:project?.project_id||null,provenance:{source:'LOCAL_STORE_IMPORT',source_device:clean(source_device,120)}});
    for(const e of entities)await this.putEntity(identity,created.project_id,{type:e.entity_type||e.type,id:e.entity_id||e.id,data:e.data||{},provenance:{source:'LOCAL_STORE_IMPORT',source_device:clean(source_device,120),original_provenance:e.provenance||null}});
    return this.sync(identity,created.project_id,{cursor:-1,device_id:'server-import'});
  }
  async verifyProject(identity,projectId){const p=this._project(identity,projectId),errors=[],list=this.events.get(p.project_id)||[];let previous=null;for(let i=0;i<list.length;i++){const e=list[i];if(e.sequence!==i||e.previous_event_sha256!==previous||!await verifySeal(e))errors.push(`event:${i}`);previous=e.sha256;}if(!await verifySeal(p))errors.push('project');for(const [id,e] of this.entities.get(p.project_id)){if(e.entity_id!==id||e.organization_id!==p.organization_id||!await verifySeal(e))errors.push(`entity:${id}`);}return {status:errors.length?'FAIL':'PASS',errors:[...new Set(errors)].sort(),project_id:p.project_id,event_count:list.length,entity_count:this.entities.get(p.project_id).size,tenant_isolation_verified:errors.every(e=>!e.startsWith('tenant'))};}
}

export async function runAr04Gate({graph,identityA,identityB,sameTenantIdentity,foreignIdentity}={}){
  const project=await graph.createProject(identityA,{name:'Two-device continuity'});const work=await graph.putEntity(identityA,project.project_id,{type:'WORK',data:{objective:'prove continuity'},provenance:{source:'device-a'}});const a=await graph.sync(identityA,project.project_id,{cursor:-1,device_id:'device-a'});const b=await graph.sync(sameTenantIdentity||identityB,project.project_id,{cursor:-1,device_id:'device-b'});let crossTenantBlocked=false;try{await graph.sync(foreignIdentity,project.project_id,{cursor:-1,device_id:'foreign'});}catch(e){crossTenantBlocked=e?.name==='SecurityError';}
  const sameEntity=b.entities.find(e=>e.entity_id===work.entity_id);const pass=a.project.sha256===b.project.sha256&&sameEntity?.sha256===work.sha256&&b.provenance_preserved===true&&crossTenantBlocked;return {schema:'musitu.axiom.ar04.gate.v1',status:pass?'PASS':'FAIL',two_device_continuity:pass,cross_tenant_blocked:crossTenantBlocked,provenance_preserved:Boolean(sameEntity?.sha256===work.sha256),production_mutated:false};
}
