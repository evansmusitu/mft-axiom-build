/** Guarded one-shot export build. Input is a read-only connector checkpoint;
 * keys stay in the existing protected Preview store. Emits ciphertext only.
 * Never promotes an app, reads provider tokens, or writes a hosted database.
 */
import {readFileSync,readdirSync,statSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sealHostedCheckpoint} from '../src/postgres/hosted-checkpoint.mjs';
if(process.env.PHASE1_HOSTED_BACKUP_EXPORT!=='YES'){
 console.error('BLOCKED: explicit private hosted checkpoint export required');process.exit(78);
}
const input=new URL('../.private-hosted-checkpoint.json',import.meta.url);
const keyNames=['BACKUP_KEY_20261018','CONTENT_ENCRYPTION_KEY','SESSION_ENCRYPTION_KEY'];
const keys=[];
try{
 for(const name of keyNames){const value=process.env[name]||'';if(!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Error();const key=Buffer.from(value,'base64');if(key.length!==32)throw Error();keys.push(key);}
 if(statSync(input).size>8*1024*1024)throw Error();
 const snapshot=JSON.parse(readFileSync(input,'utf8'));
 const dir=new URL('../db/',import.meta.url),names=readdirSync(dir).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort();
 if(names.length!==15)throw Error();
 const migrations=names.map(name=>{const sql=readFileSync(new URL(name,dir),'utf8');return{name,sql,sha256:createHash('sha256').update(sql).digest('hex')};});
 const {encrypted,receipt}=sealHostedCheckpoint({snapshot,migrations,backupKey:keys[0],contentEncryptionKey:keys[1],sessionEncryptionKey:keys[2]});
 const encoded=encrypted.toString('base64'),chunks=Math.ceil(encoded.length/1024);
 console.log(JSON.stringify({...receipt,chunks}));
 // Separate event timestamps permit lossless bounded reads from log APIs that
 // truncate large responses. The consumer verifies indexes and the whole hash.
 for(let i=0;i<chunks;i++){
  console.log(JSON.stringify({kind:'MUSITU_ENCRYPTED_CHECKPOINT_CHUNK',index:i,total:chunks,data:encoded.slice(i*1024,(i+1)*1024)}));
  await new Promise(resolve=>setTimeout(resolve,40));
 }
 console.log('CHECKPOINT_EXPORT_COMPLETE_NO_APP_PROMOTION');
}catch{
 console.error('HOSTED_CHECKPOINT_EXPORT_FAILED');process.exitCode=1;
}finally{
 for(const key of keys)key.fill(0);
 try{rmSync(input,{force:true});}catch{process.exitCode=1;}
}
