// JSON-only canonical commitments. All own keys are encoded directly, including
// names with special meaning on Object.prototype; unsupported values fail closed.
export function canonicalJson(value) {
  const ancestors=new Set();
  function encode(v) {
    if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'){
      if(!Number.isFinite(v))throw new TypeError('finite JSON numbers required');
      return JSON.stringify(v);
    }
    if(typeof v!=='object')throw new TypeError('JSON values required');
    if(ancestors.has(v))throw new TypeError('cyclic JSON is not supported');
    if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw new TypeError('plain JSON records required');
    if(Object.getOwnPropertySymbols(v).length)throw new TypeError('symbol keys are not JSON');
    ancestors.add(v);
    let encoded;
    if(Array.isArray(v)){
      if(Object.keys(v).length!==v.length)throw new TypeError('dense JSON arrays required');
      encoded='['+v.map(encode).join(',')+']';
    }else{
      encoded='{'+Object.keys(v).sort().map(k=>{
        const d=Object.getOwnPropertyDescriptor(v,k);
        if(!d||!('value' in d))throw new TypeError('JSON accessors are not supported');
        return JSON.stringify(k)+':'+encode(d.value);
      }).join(',')+'}';
    }
    ancestors.delete(v);return encoded;
  }
  return encode(value);
}

export async function sha256Json(value) {
  const bytes=new TextEncoder().encode(canonicalJson(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function verifyTaskCommitments(result) {
  if(!result?.artifact||!result?.receipt)return false;
  const {receipt_sha256,...body}=result.receipt;
  return body.artifact_sha256===await sha256Json(result.artifact)&&receipt_sha256===await sha256Json(body);
}
