// Opt-in migration adapter for existing axiom_interface/vnext/data_adapters.js.
// Do not silently replace the earned local adapter or mark local previews production.
import {AXIOMCustomerAdapter} from './browser_adapter.mjs';
export class VNextRemoteDataAdapter {
 constructor(api=new AXIOMCustomerAdapter()){this.api=api;this.cloudBacked=true;}
 static async open(){const api=new AXIOMCustomerAdapter();await api.getAccount();return new VNextRemoteDataAdapter(api);}
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
