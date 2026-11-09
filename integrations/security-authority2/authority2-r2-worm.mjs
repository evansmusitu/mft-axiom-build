/** R2 append-only per-sequence barrier (candidate, NOT an admin-irreversible attestation).
 * Requires independent indefinite bucket-lock rule with retention policy audited
 * out of band. R2 `onlyIf: If-None-Match:*` is enforced on EVERY append.
 * No retry on ambiguous success; caller must durably HOLD pending admissions.
 */
const H64=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/;
export class WormHold extends Error{constructor(reason){super(reason);this.name='WormHold';this.reason=reason;}}
const hold=code=>{throw new WormHold(code);};
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
export function wormKey(pin,seq){
  if(!pin||pin.account_id!=='67469478aa9349fa0a57fe3a72da200a'||!ID.test(pin.ledger_id)||!/^ax-[a-z0-9-]{1,60}$/.test(pin.namespace)||!Number.isSafeInteger(seq)||seq<0||seq>1000001)hold('HIGHWATER_WORM_ID_INVALID_HOLD');
  return `b27/${pin.account_id}/${pin.ledger_id}/${pin.namespace}/${String(seq).padStart(12,'0')}.json`;
}
async function readRecord(bucket,pin,seq){
  const obj=await bucket.get(wormKey(pin,seq));if(!obj)hold('HIGHWATER_WORM_PREDECESSOR_MISSING_HOLD');
  if(!Number.isSafeInteger(obj.size)||obj.size>4096)hold('HIGHWATER_WORM_OBJECT_SIZE_HOLD');
  let data;try{data=JSON.parse(await obj.text());}catch{hold('HIGHWATER_WORM_OBJECT_INVALID_HOLD');}
  if(!data||data.account_id!==pin.account_id||data.ledger_id!==pin.ledger_id||data.namespace!==pin.namespace||data.key_id!==pin.key_id||data.sequence!==seq||!H64.test(data.head))hold('HIGHWATER_WORM_OBJECT_BINDING_HOLD');
  return data;
}
export async function wormReadback(bucket,pin,tip){
  if(!bucket||typeof bucket.head!=='function'||typeof bucket.get!=='function'||typeof bucket.put!=='function')hold('HIGHWATER_WORM_BINDING_MISSING_HOLD');
  if(!Number.isSafeInteger(tip?.sequence)||tip.sequence< -1||tip.sequence>1000000||!H64.test(tip?.head))hold('HIGHWATER_WORM_TIP_INVALID_HOLD');
  if(await bucket.head(wormKey(pin,tip.sequence+1)))hold('HIGHWATER_WORM_ROLLBACK_DETECTED_HOLD');
  if(tip.sequence>=0){const record=await readRecord(bucket,pin,tip.sequence);if(record.head!==tip.head)hold('HIGHWATER_WORM_HEAD_MISMATCH_HOLD');}
  return true;
}
export async function wormAppend(bucket,pin,record){
  if(!Number.isSafeInteger(record?.sequence)||record.sequence<0||record.sequence>1000000||record.previous_sequence!==record.sequence-1||!H64.test(record?.previous_head)||!H64.test(record?.head))hold('HIGHWATER_WORM_SEQUENCE_INVALID_HOLD');
  await wormReadback(bucket,pin,{sequence:record.previous_sequence,head:record.previous_head});
  const key=wormKey(pin,record.sequence),body=canonical(record);
  if(new TextEncoder().encode(body).byteLength>4096)hold('HIGHWATER_WORM_EVENT_OVERSIZE_HOLD');
  // A retention policy alone is not enough: this precondition also forbids
  // overwrite even while the lock policy is unavailable / independently audited.
  const written=await bucket.put(key,body,{onlyIf:new Headers({'if-none-match':'*'}),httpMetadata:{contentType:'application/json'}});
  if(!written)hold('HIGHWATER_WORM_DUPLICATE_OR_UNCONFIRMED_HOLD');
  const read=await readRecord(bucket,pin,record.sequence);
  if(canonical(read)!==body)hold('HIGHWATER_WORM_READBACK_MISMATCH_HOLD');
  await wormReadback(bucket,pin,{sequence:record.sequence,head:record.head});
  return true;
}