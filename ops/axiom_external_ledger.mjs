import {canonicalJson,sha256Json} from '../axiom_interface/vnext/execution_integrity.mjs';
import {descriptor} from '../integrations/independent-ledger/protocol.mjs';
const deny=message=>{throw new DOMException(message,'NotAllowedError');};
export async function externalLedgerEvidence({db,tenant,workId,taskId,contract,client}={}){
  const ref=contract.policy.external_ledger;
  if(!ref)return {evidence:[],snapshot:[]};
  descriptor(ref);
  if(!client?.verifyStored||canonicalJson(client.reference)!==canonicalJson(ref))deny('pinned external ledger verifier required');
  const work=await db.prepare('SELECT request_sha256 FROM axiom_ec_works WHERE tenant_id=?1 AND work_id=?2').bind(tenant,workId).first();
  const reply=await db.prepare(`SELECT r.*,e.status AS ledger_status,e.ledger_id,e.grant_id,e.request_json,e.envelope_json,
    (SELECT COUNT(*) FROM axiom_ec_reservations prior WHERE prior.tenant_id=r.tenant_id AND prior.work_id=r.work_id AND prior.rowid<r.rowid) AS ledger_slot
    FROM axiom_ec_reservations r LEFT JOIN axiom_ec_external_consumptions e ON e.tenant_id=r.tenant_id AND e.reservation_id=r.reservation_id
    WHERE r.tenant_id=?1 AND r.work_id=?2 AND r.task_id=?3 ORDER BY r.rowid`).bind(tenant,workId,taskId).all();
  const rows=reply.results??reply,evidence=[],snapshot=[];
  for(const row of rows){
    if(row.ledger_status!=='CONFIRMED'||row.ledger_id!==ref.ledger_id||row.grant_id!==ref.grant_id||!row.request_json||!row.envelope_json)deny('external ledger consumption missing or unresolved');
    const request=JSON.parse(row.request_json),envelope=JSON.parse(row.envelope_json);
    if(canonicalJson(request)!==row.request_json||canonicalJson(envelope)!==row.envelope_json)deny('external ledger record is not canonical');
    const bound={tenant_id:tenant,work_id:workId,task_id:taskId,admission_sha256:work.request_sha256,contract_sha256:contract.contract_sha256,slot:row.ledger_slot,kind:row.action_kind,operation:row.operation,compute_calls:row.compute_calls,provider_calls:row.provider_calls};
    if(Object.entries(bound).some(([k,v])=>request[k]!==v))deny('external ledger record differs from the admitted reservation');
    await client.verifyStored(request,envelope);
    evidence.push({schema:'musitu.axiom.external-ledger-evidence.v1',reservation_id:row.reservation_id,request,envelope});
    snapshot.push({reservation_id:row.reservation_id,ledger_id:row.ledger_id,grant_id:row.grant_id,status:row.ledger_status,request_json:row.request_json,envelope_json:row.envelope_json});
  }
  return {evidence,snapshot};
}

export async function reserveExternalLedger({db,client,contract,admissionHash,tenant,workId,taskId,reservationId,action}={}){
  const ref=contract.policy.external_ledger;
  if(!ref||!taskId||!client?.prepare||!client?.consume)deny('active Run and pinned external ledger client required');
  let confirmed=false;
  try{
    const row=await db.prepare('SELECT (SELECT COUNT(*)-1 FROM axiom_ec_reservations z WHERE z.tenant_id=r.tenant_id AND z.work_id=r.work_id AND z.rowid<=r.rowid) AS slot FROM axiom_ec_reservations r WHERE tenant_id=?1 AND reservation_id=?2').bind(tenant,reservationId).first();
    if(!row)deny('external reservation identity missing');
    const request=await client.prepare({contract,admission_sha256:admissionHash,task_id:taskId,slot:row.slot,action});
    const update=await db.prepare("UPDATE axiom_ec_external_consumptions SET request_json=?3 WHERE tenant_id=?1 AND reservation_id=?2 AND status='STARTED' AND request_json IS NULL").bind(tenant,reservationId,canonicalJson(request)).run();
    if(Number(update.meta?.changes)!==1)deny('external reservation request cannot be replaced');
    const envelope=await client.consume(request);
    const stored=await db.prepare("UPDATE axiom_ec_external_consumptions SET status='CONFIRMED',envelope_json=?3 WHERE tenant_id=?1 AND reservation_id=?2 AND status='STARTED' AND request_json=?4").bind(tenant,reservationId,canonicalJson(envelope),canonicalJson(request)).run();
    if(Number(stored.meta?.changes)!==1)deny('external reservation response could not be committed');
    confirmed=true;return {request_sha256:await sha256Json(request),ledger_sequence:envelope.payload.ledger_sequence};
  }catch(error){
    if(!confirmed)try{await db.prepare("UPDATE axiom_ec_external_consumptions SET status=?3 WHERE tenant_id=?1 AND reservation_id=?2 AND status='STARTED'").bind(tenant,reservationId,error?.code==='LEDGER_REMOTE_DENIED_HOLD'?'DENIED':'UNCERTAIN').run();}catch{}
    throw error;
  }
}
