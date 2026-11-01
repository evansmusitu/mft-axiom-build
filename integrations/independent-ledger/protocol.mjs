/** Versioned, commitment-only ledger protocol. A valid signature is not proof of custody. */
import {canonicalJson,sha256Json} from '../../axiom_interface/vnext/execution_integrity.mjs';
export {canonicalJson,sha256Json};
export const LEDGER_SCHEMA='musitu.axiom.external-ledger.v1';
export const HASH=/^[0-9a-f]{64}$/;
export const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/;
const encoder=new TextEncoder();
export class LedgerDenied extends Error{
  constructor(code,status=403){super(code);this.name='LedgerDenied';this.code=code;this.status=status;}
}
export const deny=(code,status=403)=>{throw new LedgerDenied(code,status);};
export function exact(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))deny('INVALID_'+label,400);
  return value;
}
export const id=(v,label)=>{if(typeof v!=='string'||!ID.test(v))deny('INVALID_'+label,400);return v;};
export const digest=(v,label)=>{if(typeof v!=='string'||!HASH.test(v))deny('INVALID_'+label,400);return v;};
export const integer=(v,max=1000000)=>{if(!Number.isSafeInteger(v)||v<0||v>max)deny('INVALID_COUNTER',400);return v;};
export const bytes=value=>encoder.encode(canonicalJson(value));
export const b64=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export function fromB64(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>200)deny('INVALID_SIGNATURE',400);
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
}
export function publicKey(jwk){
  exact(jwk,['kty','crv','x'],'PUBLIC_KEY');
  if(jwk.kty!=='OKP'||jwk.crv!=='Ed25519'||fromB64(jwk.x).length!==32)deny('INVALID_PUBLIC_KEY',400);
  return jwk;
}
export const CONSUME_FIELDS=['grant_id','tenant_id','work_id','admission_sha256','contract_sha256','execution_artifact_sha256','epoch','slot','task_id','kind','operation','compute_calls','provider_calls','action_id','challenge'];
export async function validateConsume(input){
  exact(input,CONSUME_FIELDS,'CONSUME');
  for(const k of ['grant_id','tenant_id','work_id','task_id'])id(input[k],k);
  for(const k of ['admission_sha256','contract_sha256','execution_artifact_sha256','action_id','challenge'])digest(input[k],k);
  integer(input.epoch);if(!input.epoch)deny('INVALID_EPOCH',400);integer(input.slot);integer(input.compute_calls);integer(input.provider_calls);
  if(!['compute','analysis','decision','model','research'].includes(input.kind))deny('INVALID_ACTION',400);
  if(input.operation!==null)id(input.operation,'OPERATION');
  const compute=['compute','analysis'].includes(input.kind)?1:0;
  if(input.compute_calls!==compute||(['model','research'].includes(input.kind)?input.provider_calls<1:input.provider_calls!==0))deny('ACTION_COST_MISMATCH',400);
  if(input.action_id!==await actionId(input))deny('ACTION_COMMITMENT_MISMATCH',400);
  return input;
}
export async function actionId(input){
  const keys=['grant_id','tenant_id','work_id','admission_sha256','task_id','slot','kind','operation','compute_calls','provider_calls'];
  return sha256Json(Object.fromEntries(keys.map(k=>[k,input[k]])));
}
export function descriptor(value){
  exact(value,['ledger_id','genesis_id','key_id','grant_id','epoch','execution_artifact_sha256','authority_sha256'],'DESCRIPTOR');
  for(const k of ['ledger_id','genesis_id','key_id','grant_id'])id(value[k],k);
  integer(value.epoch);if(!value.epoch)deny('INVALID_EPOCH',400);digest(value.execution_artifact_sha256,'ARTIFACT');digest(value.authority_sha256,'AUTHORITY');return value;
}
export async function verifyEnvelope(envelope,{jwk,reference,request,historical=false,now=Date.now()}={}){
  exact(envelope,['payload','signature'],'ENVELOPE');publicKey(jwk);descriptor(reference);
  const p=envelope.payload;
  exact(p,['schema','operation','decision','dispatch_allowed','ledger_id','genesis_id','key_id','epoch','grant_id','tenant_id','work_id','action_id','request_sha256','challenge','slot','grant_sequence','ledger_sequence','chain_sha256','issued_at','valid_until'],'RECEIPT');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',key,fromB64(envelope.signature),bytes(p)))deny('LEDGER_SIGNATURE_INVALID');
  for(const k of ['ledger_id','genesis_id','key_id','epoch','grant_id'])if(p[k]!==reference[k])deny('LEDGER_TRUST_PIN_MISMATCH');
  if(p.schema!==LEDGER_SCHEMA||p.operation!=='consume'||p.decision!=='ALLOW_ONCE'||p.dispatch_allowed!==true)deny('LEDGER_RECEIPT_IS_NOT_PERMISSION');
  for(const k of ['tenant_id','work_id','action_id','challenge','slot'])if(p[k]!==request[k])deny('LEDGER_RECEIPT_REQUEST_MISMATCH');
  if(p.request_sha256!==await sha256Json(request)||p.grant_sequence!==request.slot+1)deny('LEDGER_RECEIPT_COMMITMENT_MISMATCH');
  integer(p.ledger_sequence);if(!p.ledger_sequence)deny('INVALID_LEDGER_SEQUENCE');digest(p.chain_sha256,'CHAIN');
  const issued=Date.parse(p.issued_at),until=Date.parse(p.valid_until);
  if(!Number.isFinite(issued)||!Number.isFinite(until)||until-issued!==15000||new Date(issued).toISOString()!==p.issued_at||new Date(until).toISOString()!==p.valid_until)deny('INVALID_RECEIPT_LIFETIME');
  if(!historical&&(issued>now+1000||until<=now))deny('LEDGER_RECEIPT_NOT_FRESH');
  return true;
}
