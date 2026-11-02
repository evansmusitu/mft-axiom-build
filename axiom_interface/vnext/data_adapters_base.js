import {ProjectStore} from "../projects.js";
import {OutcomeContractStore} from "../outcome_contracts.js";

const ACTOR_ID = "local-user";
const clean=(value,max=2000)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max);
const clone=value=>structuredClone(value);

export class VNextDataAdapter {
  constructor(projects,outcomes){
    this.projects=projects;
    this.outcomes=outcomes;
    this.actorId=ACTOR_ID;
    this.projectsApi=Object.freeze({store:this.projects});
  }

  static async open(){
    const [projects,outcomes]=await Promise.all([ProjectStore.open(),OutcomeContractStore.open()]);
    return new VNextDataAdapter(projects,outcomes);
  }

  async listProjects(){
    const rows=await this.projects.listProjects();
    const enriched=[];
    for(const project of rows){
      let objectCount=0, contractCount=0, chainVerified=false;
      try{
        const graph=await this.projects.graph(project.project_id);
        objectCount=graph.objects.length;
        chainVerified=await this.projects.verifyEventChain(project.project_id);
      }catch{}
      try{ contractCount=(await this.outcomes.list(project.project_id)).length; }catch{}
      enriched.push({...clone(project),object_count:objectCount,contract_count:contractCount,event_chain_verified:chainVerified});
    }
    return enriched;
  }

  async createProject({name,goal="",memoryScope="project-only"}={}){
    return this.projects.createProject({
      name:clean(name,120),
      goal:clean(goal,2000),
      ownerId:this.actorId,
      memoryScope,
      source:"axiom-vnext"
    });
  }

  async getProject(projectId){
    return this.projects.getProject(clean(projectId,180));
  }

  async getProjectGraph(projectId){
    return this.projects.graph(clean(projectId,180));
  }

  async verifyProjectChain(projectId){
    return this.projects.verifyEventChain(clean(projectId,180));
  }

  async listWork(projectId){
    if(!projectId) return [];
    const rows=await this.outcomes.list(clean(projectId,180));
    const enriched=[];
    for(const row of [...rows].reverse()){
      let verified=false, approval=null;
      try{ verified=await this.outcomes.verify(row.contract_id); }catch{}
      try{ approval=await this.outcomes.approval(this.projectsApi,row.contract_id); }catch{}
      enriched.push({...clone(row),integrity_verified:verified,approval});
    }
    return enriched;
  }

  async createWork(projectId,payload={}){
    const criteria=Array.isArray(payload.successCriteria)
      ? payload.successCriteria.map(x=>clean(x,1000)).filter(Boolean).join("\n")
      : clean(payload.successCriteria,8000);
    return this.outcomes.create(this.projectsApi,this.actorId,{
      projectId:clean(projectId,180),
      title:clean(payload.title,180),
      outcome:clean(payload.outcome,4000),
      successCriteria:criteria,
      privacy:payload.privacy || "Project",
      evidence:payload.evidence || "Standard",
      autonomy:payload.autonomy || "Preview only",
      approval:payload.approval || "Before consequential action",
      deadline:payload.deadline || "",
      computeBudget:payload.computeBudget ?? ""
    });
  }

  async verifyWork(contractId){
    return this.outcomes.verify(clean(contractId,180));
  }

  async approveWork(contractId){
    return this.outcomes.approve(this.projectsApi,this.actorId,clean(contractId,180));
  }

  close(){
    try{ this.projects.close(); }catch{}
    try{ this.outcomes.db?.close(); }catch{}
  }
}

export const VNEXT_DATA_BOUNDARY = Object.freeze({
  projectPersistence:"BROWSER_LOCAL_INDEXEDDB",
  outcomeExecution:"PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS",
  actorCompatibility:ACTOR_ID,
  cloudSyncClaim:false,
  multiDeviceSyncClaim:false
});
