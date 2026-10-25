/**
 * UNWIRED, OPERATOR-ONLY enterprise tenant erasure for a separately approved
 * dedicated D1 database. Never imported into the Worker or scheduled.
 *
 * This is not a legal hold determination or a substitute for reviewer approval:
 * independent authorization and DB identity MUST be checked outside this module.
 * Does not touch Cloudflare backups, caches, local browser vaults, or exports.
 */
const ID=/^[A-Za-z0-9_-]{8,64}$/;
const REF=/^[A-Za-z0-9_-]{8,80}$/;
function error(code){throw Error(code);}
export async function eraseTenantWorkspace(db, {
  tenantId,verifiedTenantId,authorizationReference,
  legalHoldCleared,confirmationPhrase,execute=false
}={}) {
  if(!db || typeof db.prepare!=='function' || typeof db.batch!=='function' ||
     typeof tenantId!=='string'||!ID.test(tenantId)||
     typeof verifiedTenantId!=='string'||verifiedTenantId!==tenantId||
     typeof authorizationReference!=='string'||!REF.test(authorizationReference)||
     legalHoldCleared!==true || confirmationPhrase!=='ERASE '+tenantId ||
     typeof execute!=='boolean')
    error('ERASURE_NOT_AUTHORIZED');
  const scope='dedicated-enterprise-d1-only';
  if(!execute) return {executed:false,tenantId,deleted:{audit:0,tenant:0},scope};
  try{
    // Check exact tenant before considering any audited deletion.
    // A second exists check in the same transaction prevents cleanup of orphan
    // audit events if this tenant disappears between preflight and D1.batch.
    const found=await db.prepare('SELECT tenant_id FROM tenants WHERE tenant_id = ?')
      .bind(tenantId).first();
    if(!found)error('ERASURE_TARGET_NOT_FOUND');
    const result=await db.batch([
      db.prepare(
        'DELETE FROM tenant_audit WHERE tenant_id = ? AND EXISTS (SELECT 1 FROM tenants WHERE tenant_id = ?)'
      ).bind(tenantId,tenantId),
      // FK cascade removes tenant memberships and encrypted artifacts.
      db.prepare('DELETE FROM tenants WHERE tenant_id = ?').bind(tenantId)
    ]);
    if(!Array.isArray(result)||result.length!==2 ||
       !Number.isSafeInteger(result[0]?.meta?.changes) ||
       result[0].meta.changes<0 || result[1]?.meta?.changes!==1)
      error('ERASURE_STORE_UNAVAILABLE');
    return {executed:true,tenantId,
      deleted:{audit:result[0].meta.changes,tenant:1},scope};
  }catch(ex){
    if(ex?.message==='ERASURE_TARGET_NOT_FOUND')throw ex;
    error('ERASURE_STORE_UNAVAILABLE');
  }
}
