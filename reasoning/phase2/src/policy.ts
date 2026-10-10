import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type { EvidenceRequirement, PolicyCheck, PolicyDecision, PolicyManifest, TemporalFact, WorldSnapshot } from "./types.ts";

const POLICY_VERSION="1.0.0";
const POLICY_IMPLEMENTATION_HASH=sha256Hex(readFileSync(fileURLToPath(import.meta.url),"utf8"));

export function evidencePolicyManifest():PolicyManifest {
  return {
    id:"axiom.evidence-policy",
    version:POLICY_VERSION,
    implementationHash:POLICY_IMPLEMENTATION_HASH
  };
}

function ms(value:string,label:string):number {
  const parsed=Date.parse(value);
  if(!Number.isFinite(parsed))throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return parsed;
}

export function resolveEvidenceFacts(snapshot:WorldSnapshot,entity:string,attribute:string):TemporalFact[] {
  const facts=snapshot.facts.filter(f=>f.entity===entity&&f.attribute===attribute);
  const ids=new Set(facts.map(f=>f.id));
  const superseded=new Set<string>();
  for(const fact of facts){
    for(const id of fact.supersedes??[])if(ids.has(id))superseded.add(id);
  }
  return facts.filter(f=>!superseded.has(f.id)).sort((a,b)=>a.id.localeCompare(b.id));
}

export function selectEvidenceFact(snapshot:WorldSnapshot,entity:string,attribute:string):TemporalFact {
  const facts=resolveEvidenceFacts(snapshot,entity,attribute);
  if(!facts.length)throw new Error(`No resolved evidence for ${entity}.${attribute}`);
  const hashes=new Set(facts.map(f=>hashJson({type:f.value.type,value:f.value.value} as any)));
  if(hashes.size>1)throw new Error(`Conflicting evidence for ${entity}.${attribute}`);
  return [...facts].sort((a,b)=>{
    const time=Date.parse(b.observedAt)-Date.parse(a.observedAt);
    return time!==0?time:a.id.localeCompare(b.id);
  })[0];
}

function checkRequirement(snapshot:WorldSnapshot,requirement:EvidenceRequirement):PolicyCheck {
  if(!requirement.id.trim())throw new TypeError("Evidence requirement id is required");
  if(!requirement.entity.trim()||!requirement.attribute.trim())throw new TypeError(`Requirement ${requirement.id} entity and attribute are required`);
  if(!Number.isFinite(requirement.maxAgeMs)||requirement.maxAgeMs<0)throw new RangeError(`Requirement ${requirement.id} maxAgeMs must be a non-negative finite number`);
  const resolved=resolveEvidenceFacts(snapshot,requirement.entity,requirement.attribute);
  const factIds=resolved.map(f=>f.id);

  if(resolved.length===0){
    return {requirementId:requirement.id,ok:false,code:"MISSING_EVIDENCE",factIds:[],message:`No active evidence for ${requirement.entity}.${requirement.attribute}`};
  }

  const valueHashes=new Set(resolved.map(f=>hashJson({type:f.value.type,value:f.value.value} as any)));
  if(valueHashes.size>1){
    return {requirementId:requirement.id,ok:false,code:"CONFLICTING_EVIDENCE",factIds,message:`Unresolved facts disagree for ${requirement.entity}.${requirement.attribute}`};
  }

  const asOfMs=ms(snapshot.asOf,"snapshot.asOf");
  const observed=resolved.map(f=>({id:f.id,at:ms(f.observedAt,`fact ${f.id} observedAt`)}));
  const future=observed.filter(x=>x.at>asOfMs);
  if(future.length){
    return {requirementId:requirement.id,ok:false,code:"FUTURE_EVIDENCE",factIds:future.map(x=>x.id).sort(),message:"Evidence was observed after the snapshot as-of time"};
  }

  const freshest=Math.max(...observed.map(x=>x.at));
  if(asOfMs-freshest>requirement.maxAgeMs){
    return {requirementId:requirement.id,ok:false,code:"STALE_EVIDENCE",factIds,message:`Evidence age exceeds ${requirement.maxAgeMs}ms`};
  }

  return {requirementId:requirement.id,ok:true,code:"OK",factIds,message:"Evidence requirement satisfied"};
}

export function evaluateEvidencePolicy(snapshot:WorldSnapshot,requirements:EvidenceRequirement[]):PolicyDecision {
  const checks=[...requirements].sort((a,b)=>a.id.localeCompare(b.id)).map(req=>checkRequirement(snapshot,req));
  return {status:checks.every(c=>c.ok)?"ALLOW":"DENY",snapshotId:snapshot.snapshotId,checks};
}
