/** Fixture-only typed persistence candidate. No release or production authority. */
export const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
export const SCHEMA='musitu.axiom.frontier.isolated-staging.v1';
export const H64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const FORBIDDEN=new Set(['ccc473f1-fbb5-4b8d-8a24-45f3696ac10f','504029cc-f9a5-495e-818f-63c6144b4ea4',
 'be760b23-2ed1-47aa-92aa-9042ce917bb9','5c092b73-d093-483d-adf9-9883a8c2f063',
 'c023a0a0-472a-4178-ad07-02f1d6b2e122']);
export class StagingHold extends Error{constructor(code,status=503){super(code);this.code=code;this.status=status;}}
export const hold=(code,status)=>{throw new StagingHold(code,status);};
export function exact(x,keys){
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).length!==keys.length||
  !keys.every(k=>Object.hasOwn(x,k)))hold('FRONTIER_STAGE_FIELDS_HOLD',400);
}
export function fixtureId(value){
 if(typeof value!=='string'||!/^fixture_[a-z0-9][a-z0-9_]{0,70}$/.test(value))hold('FRONTIER_STAGE_FIXTURE_ID_REQUIRED',400);
 return value;
}
export function validateScope(pin){
 exact(pin,['schema','account_id','database_id','scope_nonce']);
 if(pin.schema!==SCHEMA||pin.account_id!==ACCOUNT||typeof pin.database_id!=='string'||
  !UUID.test(pin.database_id)||FORBIDDEN.has(pin.database_id)||
  typeof pin.scope_nonce!=='string'||!H64.test(pin.scope_nonce))hold('FRONTIER_STAGE_TARGET_NOT_ADMITTED');
 return Object.freeze(structuredClone(pin));
}
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(
  k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 if(value===null||typeof value==='string'||typeof value==='boolean'||
  typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 hold('FRONTIER_STAGE_JSON_VALUE_HOLD',400);
}
export async function sha(value){
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(
  x=>x.toString(16).padStart(2,'0')).join('');
}
