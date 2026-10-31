/**
 * MUSITU Store V2 — isolated server-side OIDC flow ledger candidate.
 * Real PostgreSQL `query` and 256-bit key supplied by approved trusted operator.
 * No table creation, provider enrollment, network calls or publish/payment rights.
 * SQL migration is separate, review-only. Each consume is atomic DB DELETE RETURNING.
 */
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

const STATE=/^[A-Za-z0-9_-]{43}$/;
const VERIFIER=/^[A-Za-z0-9_-]{86}$/;
const CLIENT=/^[A-Za-z0-9:_-]{6,128}$/;
const error=()=>new Error('oidc_ledger_denied');
const digest=x=>createHash('sha256').update(x).digest('hex');
const BEGIN_SQL=`INSERT INTO store_publisher_private.oidc_flows
 (state_digest, encrypted_record, expires_at)
 VALUES ($1, $2, to_timestamp($3::double precision/1000.0))
 ON CONFLICT (state_digest) DO NOTHING RETURNING state_digest`;
const CONSUME_SQL=`DELETE FROM store_publisher_private.oidc_flows
 WHERE state_digest=$1 AND expires_at>clock_timestamp()
 RETURNING encrypted_record`;
function isHttps(x){
 try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&x.length<=512;}catch{return false;}
}
function valid(record,now,maxAgeMs=30_000){
 return record&&typeof record==='object'&&!Array.isArray(record)&&
  Object.keys(record).sort().join(',')==='clientId,createdAt,issuer,nonce,redirectUri,state,verifier'&&
  typeof record.state==='string'&&STATE.test(record.state)&&
  typeof record.nonce==='string'&&STATE.test(record.nonce)&&
  typeof record.verifier==='string'&&VERIFIER.test(record.verifier)&&
  typeof record.clientId==='string'&&CLIENT.test(record.clientId)&&
  typeof record.issuer==='string'&&isHttps(record.issuer)&&
  typeof record.redirectUri==='string'&&isHttps(record.redirectUri)&&
  Number.isSafeInteger(record.createdAt)&&record.createdAt<=now+30_000&&now-record.createdAt<=maxAgeMs;
}
export function createEncryptedPostgresOidcLedger({query,encryptionKey,now=Date.now}={}){
 if(typeof query!=='function'||typeof now!=='function'||!Buffer.isBuffer(encryptionKey)||encryptionKey.length!==32)throw error();
 // Keep key outside DB; provider/operator-approved KMS controls key lifecycle.
 const key=Buffer.from(encryptionKey);
 return Object.freeze({
  async begin(record){
   try{
    if(!valid(record,now()))throw error();
    const identity=digest(record.state),iv=randomBytes(12),plain=Buffer.from(JSON.stringify(record));
    const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(identity));
    const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]),tag=cipher.getAuthTag();
    plain.fill(0);
    const sealed=Buffer.concat([Buffer.from([1]),iv,tag,encrypted]);
    const r=await query(BEGIN_SQL,[identity,sealed,record.createdAt+300_000]);
    if(!r||!Array.isArray(r.rows)||!Number.isInteger(r.rowCount)||r.rowCount!==r.rows.length||r.rowCount>1||r.rowCount<0)throw error();
    return r.rowCount===1&&r.rows[0]?.state_digest===identity;
   }catch{throw error();}
  },
  async consume(state){
   try{
    if(typeof state!=='string'||!STATE.test(state))throw error();
    const identity=digest(state),r=await query(CONSUME_SQL,[identity]);
    if(!r||!Array.isArray(r.rows)||!Number.isInteger(r.rowCount)||r.rowCount!==r.rows.length||r.rowCount>1||r.rowCount<0)throw error();
    if(r.rowCount===0)return null;
    const sealed=r.rows[0]?.encrypted_record;
    if(!Buffer.isBuffer(sealed)||sealed.length<30||sealed.length>4096||sealed[0]!==1)throw error();
    const decipher=createDecipheriv('aes-256-gcm',key,sealed.subarray(1,13));
    decipher.setAAD(Buffer.from(identity));decipher.setAuthTag(sealed.subarray(13,29));
    const plain=Buffer.concat([decipher.update(sealed.subarray(29)),decipher.final()]);
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));plain.fill(0);
    if(!valid(parsed,now(),300_000)||parsed.state!==state||parsed.createdAt+300_000<=now())throw error();
    return parsed;
   }catch{throw error();}
  }
 });
}
