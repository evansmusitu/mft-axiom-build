/**
 * Explicit operator-only helper, NOT wired to any HTTP API, scheduler or live DB.
 * Removes only a single explicitly selected tenant's expired metadata audit
 * rows in bounded deterministic batches.
 * Never reads/deletes tenant ciphertext and never logs tenant or subject IDs.
 * Calling is insufficient: execute:true must be explicitly specified.
 */
export async function pruneTenantAudit(db,{
  now,tenantId,retentionDays=30,batchSize=50,execute=false
}={}) {
  if(!db || typeof db.prepare!=='function' ||
     typeof tenantId!=='string' || !/^[A-Za-z0-9_-]{8,64}$/.test(tenantId) ||
     !Number.isSafeInteger(now) || now<0 ||
     !Number.isSafeInteger(retentionDays)||retentionDays<1||retentionDays>365 ||
     !Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100 ||
     typeof execute!=='boolean')
    throw Error('INVALID_RETENTION_PARAMETERS');
  const report={executed:false,deleted:0,retentionDays,batchSize};
  if(!execute)return report;
  const cutoff=now-retentionDays*86400;
  const statement=
    'DELETE FROM tenant_audit WHERE id IN ('+
    'SELECT id FROM tenant_audit WHERE tenant_id = ? AND at < ? ORDER BY at ASC, id ASC LIMIT ?)';
  let result;
  try{
    result=await db.prepare(statement).bind(tenantId,cutoff,batchSize).run();
  }catch{throw Error('STORE_UNAVAILABLE');}
  const changes=result?.meta?.changes;
  if(!Number.isSafeInteger(changes)||changes<0||changes>batchSize)
    throw Error('STORE_UNAVAILABLE');
  return {executed:true,deleted:changes,retentionDays,batchSize};
}
