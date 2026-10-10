import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hashJson, sha256Hex } from "../../phase1/src/canonical.ts";
import type { AuthorizationGrantRepository } from "./repositories.ts";
import type {
  ApiAction, ApiResource, AuthenticatedPrincipal, AuthorizationDecision, AuthorizationGrant,
  AuthorizationPolicyManifest, AuthorizationTarget, AuthorizedTenantContext
} from "./types.ts";

const AUTHORIZATION_VERSION="1.0.0";
const AUTHORIZATION_IMPLEMENTATION_HASH=sha256Hex(readFileSync(fileURLToPath(import.meta.url),"utf8"));
const ACTIONS=new Set<ApiAction>(["fact:ingest","execution:create","execution:read","execution:replay","execution:job:read","evidence:acquire","model:compile","model:execute","model:dispatch","model:explain"]);

function nonEmpty(value:unknown):value is string {
  return typeof value==="string"&&Boolean(value.trim());
}
function validResource(action:unknown,resource:unknown):resource is ApiResource {
  if(!resource||typeof resource!=="object")return false;
  const r=resource as any;
  if(r.kind!=="fact"&&r.kind!=="execution"&&r.kind!=="execution_job"&&r.kind!=="evidence"&&r.kind!=="model_compilation")return false;
  if(r.id!==undefined&&!nonEmpty(r.id))return false;
  if(action==="fact:ingest")return r.kind==="fact";
  if(action==="execution:create")return r.kind==="execution";
  if(action==="execution:read"||action==="execution:replay")return r.kind==="execution"&&nonEmpty(r.id);
  if(action==="execution:job:read")return r.kind==="execution_job"&&nonEmpty(r.id);
  if(action==="evidence:acquire")return r.kind==="evidence"&&r.id===undefined;
  if(action==="model:compile")return r.kind==="model_compilation"&&r.id===undefined;
  if(action==="model:execute"||action==="model:dispatch")return r.kind==="model_compilation"&&nonEmpty(r.id);
  if(action==="model:explain")return r.kind==="execution"&&nonEmpty(r.id);
  return false;
}
function validTarget(target:AuthorizationTarget):boolean {
  return Boolean(target&&nonEmpty(target.requestedTenantId)&&ACTIONS.has(target.action)&&validResource(target.action,target.resource));
}
function grantCore(grant:AuthorizationGrant) {
  return {
    grantId:grant.grantId,
    principalId:grant.principalId,
    tenantId:grant.tenantId,
    action:grant.action
  };
}
function sortedGrants(grants:AuthorizationGrant[]):AuthorizationGrant[] {
  return [...grants].sort((a,b)=>
    a.grantId.localeCompare(b.grantId)||
    a.principalId.localeCompare(b.principalId)||
    a.tenantId.localeCompare(b.tenantId)||
    a.action.localeCompare(b.action)
  );
}
function manifest(grants:AuthorizationGrant[]):AuthorizationPolicyManifest {
  return {
    id:"axiom.api-authorization",
    version:AUTHORIZATION_VERSION,
    implementationHash:AUTHORIZATION_IMPLEMENTATION_HASH,
    grantsHash:hashJson(sortedGrants(grants).map(grantCore) as any)
  };
}
function decision(
  status:"ALLOW"|"DENY",
  principalId:string,
  target:AuthorizationTarget,
  grants:AuthorizationGrant[],
  matchedGrantIds:string[]
):AuthorizationDecision {
  const core={
    status,
    principalId,
    requestedTenantId:target?.requestedTenantId??"",
    action:target?.action as ApiAction,
    resource:structuredClone(target?.resource??{kind:"execution"}) as ApiResource,
    matchedGrantIds:[...matchedGrantIds].sort(),
    policyManifest:manifest(grants)
  };
  return {...core,decisionHash:hashJson(core as any)};
}
function assertGrant(grant:AuthorizationGrant,principalId:string,tenantId:string):void {
  if(
    !nonEmpty(grant.grantId)||
    grant.principalId!==principalId||
    grant.tenantId!==tenantId||
    !ACTIONS.has(grant.action)
  )throw new Error("Authorization grant repository returned invalid or cross-scope grant");
}

export class DeterministicAuthorizer {
  private readonly grants:AuthorizationGrantRepository;
  constructor(grants:AuthorizationGrantRepository){this.grants=grants;}

  async authorize(authenticated:AuthenticatedPrincipal,target:AuthorizationTarget):Promise<AuthorizationDecision> {
    const principalId=authenticated?.principal?.principalId;
    if(!nonEmpty(principalId))throw new TypeError("Authenticated principalId is required");
    if(!validTarget(target))return decision("DENY",principalId,target,[],[]);

    const applicable=await this.grants.listApplicable(principalId,target.requestedTenantId);
    for(const grant of applicable)assertGrant(grant,principalId,target.requestedTenantId);
    const canonical=sortedGrants(applicable);
    const matched=canonical.filter(grant=>grant.action===target.action).map(grant=>grant.grantId);
    return decision(matched.length?"ALLOW":"DENY",principalId,target,canonical,matched);
  }
}

export function createAuthorizedTenantContext(
  authenticated:AuthenticatedPrincipal,
  target:AuthorizationTarget,
  authorization:AuthorizationDecision
):AuthorizedTenantContext {
  if(authorization.status!=="ALLOW")throw new Error("Authorization denied; trusted tenant context cannot be created");
  if(
    authorization.principalId!==authenticated.principal.principalId||
    authorization.requestedTenantId!==target.requestedTenantId||
    authorization.action!==target.action||
    hashJson(authorization.resource as any)!==hashJson(target.resource as any)
  )throw new Error("Authorization decision does not match requested context");
  return {
    principal:structuredClone(authenticated.principal),
    credential:structuredClone(authenticated.credential),
    tenant:{tenantId:target.requestedTenantId},
    authorization:structuredClone(authorization)
  };
}
