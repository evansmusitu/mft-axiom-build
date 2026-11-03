import {hashJson} from "../../phase1/src/canonical.ts";
export interface TenantAdmissionQuotaPolicy{tenantId:string;maxOutstandingJobs:number}
export function tenantAdmissionPolicyHash(p:TenantAdmissionQuotaPolicy):string{
 return hashJson({domain:"AXIOM_TENANT_ADMISSION_QUOTA_V1",tenantId:p.tenantId,maxOutstandingJobs:p.maxOutstandingJobs});
}
export function validateTenantAdmissionQuotas(policies:readonly TenantAdmissionQuotaPolicy[]){
 if(!Array.isArray(policies)||policies.length===0)throw new TypeError("Tenant quota policies required");
 const names=new Set<string>();
 const result=[];
 for(const p of policies){
  if(!p||typeof p.tenantId!=="string"||!p.tenantId.trim()||p.tenantId!==p.tenantId.trim()||p.tenantId.length>256)
   throw new TypeError("Invalid quota tenant");
  if(!Number.isSafeInteger(p.maxOutstandingJobs)||p.maxOutstandingJobs<1||p.maxOutstandingJobs>1_000_000)
   throw new RangeError("Tenant quota capacity must be a positive bounded integer");
  if(names.has(p.tenantId))throw new TypeError("Duplicate tenant quota");
  names.add(p.tenantId);
  result.push({...p,policyHash:tenantAdmissionPolicyHash(p)});
 }
 return result.sort((a,b)=>a.tenantId.localeCompare(b.tenantId));
}
