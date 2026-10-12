/**
 * Dedicated synthetic-only Cloudflare SQLite Durable Object storage probe.
 * No tenant IDs, user identities, customer records, merchant keys, mail, or payment operations.
 * This proof code NEVER satisfies a production release gate.
 */
const FLAGS=Object.freeze(['MMF_STAGE_ONLY','MMF_REAL_SEND_ENABLED','MMF_COMMERCE_ENABLED','MMF_CUSTOMER_API_ENABLED','MMF_MAIL_SENDING_ENABLED']);
const PROBE=/^[a-f0-9]{64}$/;
const deny=()=>{throw Error('MMF_PRIVATE_SQLITE_PROOF_DENIED')};
export function assertMmfPrivateProofFlags(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||
    Object.keys(input).length!==FLAGS.length||
    FLAGS.some(k=>!Object.hasOwn(input,k)||input[k]!=='false'))deny();
 return true;
}
const SQL_INIT='CREATE TABLE IF NOT EXISTS mmf_private_sqlite_probe_20261012 (key TEXT PRIMARY KEY, digest TEXT NOT NULL)';
const SQL_WRITE="INSERT INTO mmf_private_sqlite_probe_20261012 (key,digest) VALUES ('isolated',?) ON CONFLICT(key) DO UPDATE SET digest=excluded.digest";
const SQL_READ="SELECT digest FROM mmf_private_sqlite_probe_20261012 WHERE key='isolated'";
const SQL_DELETE="DELETE FROM mmf_private_sqlite_probe_20261012 WHERE key='isolated'";
function storageCheck(storage){if(typeof storage?.sql?.exec!=='function'||typeof storage?.transactionSync!=='function')deny();return storage}
export function writeMmfSyntheticProof(storage,value){
 storageCheck(storage);if(typeof value!=='string'||!PROBE.test(value))deny();
 storage.transactionSync(()=>{storage.sql.exec(SQL_INIT);storage.sql.exec(SQL_WRITE,value)});
 return {stored:true};
}
export function readMmfSyntheticProof(storage){
 storageCheck(storage);storage.sql.exec(SQL_INIT);
 const cursor=storage.sql.exec(SQL_READ);if(typeof cursor?.toArray!=='function')deny();
 const rows=cursor.toArray();if(!Array.isArray(rows)||rows.length>1)deny();
 const x=rows[0]?.digest??null;
 if(x!==null&&(typeof x!=='string'||!PROBE.test(x)))deny();
 return x;
}
export function clearMmfSyntheticProof(storage){
 storageCheck(storage);storage.transactionSync(()=>{storage.sql.exec(SQL_INIT);storage.sql.exec(SQL_DELETE)});
 return {cleared:true};
}
export function mmfPrivateFlagsFromCloudEnv(env){
 return Object.fromEntries(FLAGS.map(k=>[k,env?.[k]]));
}