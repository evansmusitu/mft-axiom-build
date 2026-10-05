import {ProjectStore} from '../projects.js';
import {OutcomeContractStore} from '../outcome_contracts.js';
import {MemoryGraphStore} from '../memory_store.js';
import {MEMORY_NETWORK_POLICY,MEMORY_SECRET_POLICY} from '../memory_security.js';
import {verifyProjectWorkMemoryProvenance} from './provenance_verifier.js';
const ACTOR_ID='local-user';
const clean=(value,max=240)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
export const FA08_RUNTIME_BOUNDARY=Object.freeze({phase:'FA-08',persistence:'BROWSER_LOCAL_INDEXEDDB',cloudSyncClaim:false,multiDeviceSyncClaim:false,externalConsequentialExecution:false,networkPolicy:MEMORY_NETWORK_POLICY,secretPolicy:MEMORY_SECRET_POLICY,actorCompatibility:ACTOR_ID,gate:'PRESERVE_PROVENANCE'});
export class VNextProjectWorkMemoryBridge{
  constructor(projects,outcomes,memory){this.projects=projects;this.outcomes=outcomes;this.memory=memory;this.actorId=ACTOR_ID;}
  static async open(){const [projects,outcomes]=await Promise.all([ProjectStore.open(),OutcomeContractStore.open()]);const memory=await MemoryGraphStore.open({projects:{store:projects}});return new VNextProjectWorkMemoryBridge(projects,outcomes,memory);}
  async listProjects(){return this.projects.listProjects();}
  async graph(projectId){return this.projects.graph(clean(projectId,180));}
  async listWork(projectId){return this.outcomes.list(clean(projectId,180));}
  async listMemory(projectId){return this.memory.list(clean(projectId,180));}
  async recall(projectId,{subject='',allowedScopes=['private','project'],viewer=this.actorId}={}){return this.memory.recall(clean(projectId,180),{subject:clean(subject,180),viewer:clean(viewer,120),allowed_scopes:[...new Set(allowedScopes)]});}
  async remember(projectId,input={}){return this.memory.remember(clean(projectId,180),this.actorId,input);}
  async markDoNotUse(memoryId,consentSource='vnext-explicit-user-do-not-use'){return this.memory.markDoNotUse(clean(memoryId,180),this.actorId,clean(consentSource,240));}
  async verifyProvenance(projectId){
    projectId=clean(projectId,180);
    const [graph,projectChainVerified,contracts,memories,memoryIntegrity]=await Promise.all([this.projects.graph(projectId),this.projects.verifyEventChain(projectId),this.outcomes.list(projectId),this.memory.list(projectId),this.memory.verify(projectId)]);
    const contractIntegrity={};
    for(const contract of contracts){try{contractIntegrity[contract.contract_id]=await this.outcomes.verify(contract.contract_id);}catch{contractIntegrity[contract.contract_id]=false;}}
    return verifyProjectWorkMemoryProvenance({graph,project_chain_verified:projectChainVerified,contracts,contract_integrity:contractIntegrity,memories,memory_integrity:memoryIntegrity});
  }
  close(){try{this.projects.close();}catch{}try{this.outcomes.db?.close();}catch{}try{this.memory.close();}catch{}}
}
