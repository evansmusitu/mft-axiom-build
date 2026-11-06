// Opt-in migration adapter for existing axiom_interface/vnext/data_adapters.js.
// Do not silently replace the earned local adapter or mark local previews production.
import {AXIOMCustomerAdapter} from './browser_adapter.mjs';
const ADMITTED=Symbol('account-bound-admission');
const valid=s=>typeof s==='string'&&s.length>0&&s.length<=160;
export class VNextRemoteDataAdapter {
 constructor(api,capability,binding){
  if(capability!==ADMITTED||!api||!binding)throw new Error('remote_admission_required');
  this.api=api;this.cloudBacked=true;this.accountVerified=true;
  this.tenantId=binding.tenantId;this.identityId=binding.identityId;
 }
 static async open({tenantId,identityId,origin}={}){
  if(!valid(tenantId)||!valid(identityId)||!valid(origin))throw new Error('remote_account_binding_required');
  let u;try{u=new URL(origin)}catch{throw new Error('remote_origin_invalid')}
  if(u.protocol!=='https:'||u.username||u.password||origin!==u.origin)throw new Error('remote_origin_invalid');
  if(typeof location!=='undefined'&&location.origin!==origin)throw new Error('remote_origin_mismatch');
  const api=new AXIOMCustomerAdapter();const account=await api.getAccount();
  if(account?.ok!==true||account.tenant_id!==tenantId||account.identity_id!==identityId||
    !['owner','admin','member','viewer'].includes(account.role))throw new Error('remote_account_mismatch');
  return new VNextRemoteDataAdapter(api,ADMITTED,{tenantId,identityId});
 }
 async listProjects(){const x=await this.api.getProjects();return x.projects.map(p=>({project_id:p.id,name:p.name,goal:p.objective,object_count:null,contract_count:null,event_chain_verified:false,storage_class:'server_candidate'}));}
 async createProject({name,goal=''}){const x=await this.api.createProject(name,goal);return {project_id:x.project.id,name:x.project.name,goal:x.project.objective};}
 async getProject(projectId){const rows=await this.listProjects();const r=rows.find(p=>p.project_id===projectId);if(!r)throw new Error('project_not_found');return r;}
 async listWork(projectId){const x=await this.api.getWork(projectId);return x.work.map(w=>({contract_id:w.id,project_id:w.project_id,title:w.title,outcome:w.desired_outcome,state:w.state,integrity_verified:false,approval:null}));}
 async createWork(projectId,payload){const x=await this.api.createWork(projectId,payload.title,payload.outcome);return {contract_id:x.work.id,project_id:projectId,title:payload.title,outcome:payload.outcome};}
 async getProjectGraph(){throw new Error('server_side_project_graph_not_qualified');}
 async verifyProjectChain(){return false;}
 async verifyWork(){return false;}
 async approveWork(){throw new Error('independent_approval_gateway_required');}
 close(){}
}
export const REMOTE_BOUNDARY=Object.freeze({cloudBackedCandidate:true,executionQualified:false,independentVerifierQualified:false,oauthProductionQualified:false,canClaimPhase14:false,canClaimPhase15:false});
