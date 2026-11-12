/**
 * Step1 offline backup transport ONLY. Never fetches/exports D1, never deploys.
 * Hybrid X25519 -> HKDF-SHA256 -> AES-256-GCM authenticated envelope.
 * Caller must obtain custodian's public-key fingerprint through an independent
 * channel. This cannot prove independent human custody, hosted backup, restore,
 * D1 ownership or release approval. No raw data or private key is logged.
 */
import {
 createPublicKey,createPrivateKey,generateKeyPairSync,diffieHellman,
 createCipheriv,createDecipheriv,createHash,randomBytes,hkdfSync,
} from 'node:crypto';

const SCHEMA='musitu.axiom.step1.encrypted-sql-export-envelope.v1';
const ACCOUNT='93f395f5121954671f92fffa453d6b61';
const DATABASE='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
const HEX=/^[0-9a-f]{64}$/;
const MAX_SQL=8_000_000;
const KEYS=['schema','source_account','source_database','captured_at','bookmark_sha256',
 'catalog_sha256','recipient_spki_sha256','ephemeral_spki_der_b64','salt_b64','iv_b64',
 'ciphertext_b64','tag_b64'];
export class BackupNoGo extends Error {
 constructor(code){super(code);this.code=code;this.name='BackupNoGo'}
}
function fail(ok,code){if(!ok)throw new BackupNoGo(code)}
const sha=b=>createHash('sha256').update(b).digest('hex');
function checkedTime(s){
 fail(typeof s==='string'&&s.length<=32,'INVALID_CAPTURE_TIME');
 const value=new Date(s);
 fail(Number.isFinite(value.getTime())&&value.toISOString()===s,'NONCANONICAL_CAPTURE_TIME');
 return s;
}
function decode(value,code,max=4096){
 fail(typeof value==='string'&&value.length>0&&value.length<=max,'INVALID_'+code);
 fail(/^[A-Za-z0-9+/]+={0,2}$/.test(value),'BAD_BASE64_'+code);
 const bytes=Buffer.from(value,'base64');
 fail(bytes.toString('base64')===value,'NONCANONICAL_BASE64_'+code);
 return bytes;
}
function publicDer(key){
 const obj=createPublicKey(key);
 fail(obj.asymmetricKeyType==='x25519','CUSTODIAN_NOT_X25519');
 return obj.export({format:'der',type:'spki'});
}
function derive(privateKey,publicKey,salt,metadata){
 const raw=diffieHellman({privateKey,publicKey});
 const info=Buffer.from('MUSITU_AXIOM_STEP1_D1_EXPORT_V1:'+sha(JSON.stringify(metadata)));
 return Buffer.from(hkdfSync('sha256',raw,salt,info,32));
}
function payloadMetadata(v){
 return {schema:SCHEMA,source_account:ACCOUNT,source_database:DATABASE,
  captured_at:v.captured_at,bookmark_sha256:v.bookmark_sha256,
  catalog_sha256:v.catalog_sha256,recipient_spki_sha256:v.recipient_spki_sha256,
  ephemeral_spki_der_b64:v.ephemeral_spki_der_b64,salt_b64:v.salt_b64,iv_b64:v.iv_b64};
}
function checkMetadata(v){
 fail(v?.schema===SCHEMA&&v.source_account===ACCOUNT&&v.source_database===DATABASE,'SOURCE_IDENTITY_MISMATCH');
 checkedTime(v.captured_at);
 fail(HEX.test(v.bookmark_sha256||'')&&HEX.test(v.catalog_sha256||'')&&
   HEX.test(v.recipient_spki_sha256||''),'MISSING_SOURCE_PINS');
 const salt=decode(v.salt_b64,'SALT',128),iv=decode(v.iv_b64,'IV',128);
 fail(salt.length===32&&iv.length===12,'BAD_AEAD_PARAMETERS');
 return {salt,iv};
}
/** Caller provides source data and pins; this routine does not read provider data. */
export function sealSqlExport({sql,custodianPublicSpkiDer,trustedCustodianSpkiSha256,
 bookmarkSha256,catalogSha256,capturedAt}){
 fail(Buffer.isBuffer(sql)&&sql.length>0&&sql.length<=MAX_SQL,'UNQUALIFIED_SQL_SIZE');
 fail(HEX.test(trustedCustodianSpkiSha256||''),'UNPINNED_CUSTODIAN_KEY');
 fail(Buffer.isBuffer(custodianPublicSpkiDer)&&custodianPublicSpkiDer.length<4096,'INVALID_CUSTODIAN_KEY_DER');
 fail(sha(custodianPublicSpkiDer)===trustedCustodianSpkiSha256,'CUSTODIAN_PUBLIC_KEY_PIN_MISMATCH');
 const recipient=createPublicKey({key:custodianPublicSpkiDer,format:'der',type:'spki'});
 fail(recipient.asymmetricKeyType==='x25519','CUSTODIAN_NOT_X25519');
 const ephemeral=generateKeyPairSync('x25519');
 const salt=randomBytes(32),iv=randomBytes(12);
 const metadata=payloadMetadata({
  captured_at:capturedAt,bookmark_sha256:bookmarkSha256,
  catalog_sha256:catalogSha256,recipient_spki_sha256:trustedCustodianSpkiSha256,
  ephemeral_spki_der_b64:publicDer(ephemeral.privateKey).toString('base64'),
  salt_b64:salt.toString('base64'),iv_b64:iv.toString('base64')});
 checkMetadata(metadata);
 const key=derive(ephemeral.privateKey,recipient,salt,metadata);
 try {
  const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});
  cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const ciphertext=Buffer.concat([cipher.update(sql),cipher.final()]);
  const body={...metadata,ciphertext_b64:ciphertext.toString('base64'),
   tag_b64:cipher.getAuthTag().toString('base64')};
  return Object.freeze({...body});
 }finally{key.fill(0)}
}
/** Only custodian with pinned private key may decrypt; returns bytes in memory. */
export function openSqlExport({envelope,custodianPrivateKey,expectedCustodianSpkiSha256,
 expectedBookmarkSha256,expectedCatalogSha256}){
 fail(envelope&&typeof envelope==='object'&&!Array.isArray(envelope),'INVALID_ENVELOPE');
 fail(Object.keys(envelope).sort().join('|')===KEYS.slice().sort().join('|'),'EXTRA_OR_MISSING_ENVELOPE_FIELDS');
 const {salt,iv}=checkMetadata(envelope);
 fail(expectedCustodianSpkiSha256===envelope.recipient_spki_sha256 &&
  HEX.test(expectedCustodianSpkiSha256||''),'CUSTODIAN_PIN_NOT_INDEPENDENTLY_PROVIDED');
 fail(expectedBookmarkSha256===envelope.bookmark_sha256 &&
  HEX.test(expectedBookmarkSha256||''),'BOOKMARK_PIN_DRIFT');
 fail(expectedCatalogSha256===envelope.catalog_sha256 &&
  HEX.test(expectedCatalogSha256||''),'CATALOG_PIN_DRIFT');
 const keyObj=custodianPrivateKey?.type==='private' && custodianPrivateKey?.asymmetricKeyType==='x25519'
  ? custodianPrivateKey : createPrivateKey(custodianPrivateKey);
 fail(keyObj.asymmetricKeyType==='x25519','CUSTODIAN_PRIVATE_KEY_NOT_X25519');
 fail(sha(publicDer(keyObj))===expectedCustodianSpkiSha256,'INCORRECT_CUSTODIAN_PRIVATE_KEY');
 const eph=decode(envelope.ephemeral_spki_der_b64,'EPHEMERAL',4096);
 const publicKey=createPublicKey({key:eph,format:'der',type:'spki'});
 fail(publicKey.asymmetricKeyType==='x25519','BAD_EPHEMERAL_KEY');
 const ciphertext=decode(envelope.ciphertext_b64,'CIPHERTEXT',Math.ceil(MAX_SQL*4/3)+16);
 fail(ciphertext.length>0&&ciphertext.length<=MAX_SQL,'CIPHERTEXT_OVER_BUDGET');
 const tag=decode(envelope.tag_b64,'TAG',100);
 fail(tag.length===16,'INVALID_AUTH_TAG');
 const metadata=payloadMetadata(envelope);
 const key=derive(keyObj,publicKey,salt,metadata);
 try{
  const decipher=createDecipheriv('aes-256-gcm',key,iv,{authTagLength:16});
  decipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  decipher.setAuthTag(tag);
  try{return Buffer.concat([decipher.update(ciphertext),decipher.final()])}
  catch {throw new BackupNoGo('CIPHERTEXT_OR_METADATA_NOT_AUTHENTIC')}
 }finally{key.fill(0)}
}
/** Static capability statement: cryptography alone never admits custody/recovery. */
export function encryptionScope(){
 return Object.freeze({schema:'musitu.axiom.step1.encryption-scope.v1',
  source_sql_export_performed:false,provider_d1_mutations:0,
  encrypted_backup_custody_qualified:false,independent_human_custody_qualified:false,
  target_restore_qualified:false,source_reuse_authorized:false,step_2_authorized:false,
  release_authority:false,status:'OFFLINE_CRYPTOGRAPHIC_TEST_ONLY'});
}
