import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {sealPostgresBackup,openPostgresBackup} from '../src/postgres/encrypted-backup.mjs';
const tables=['action_audit','ai_policy','ai_requests','bookings','business_configuration','channel_consent_evidence','contacts','conversations','customer_suppressions','draft_approvals','faqs','inbound_events','memberships','message_status_events','messages','outbound_attempts','outbound_preparations','reply_drafts','resources','tenants','whatsapp_channels'].map(n=>'musitu.'+n).concat('musitu_identity.sessions');
function fixture(schemaVersion=17){
 const directory=new URL('../db/',import.meta.url);
 const migrations=readdirSync(directory).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort().slice(0,schemaVersion).map(name=>{const sql=readFileSync(new URL(name,directory),'utf8');return{name,sql,sha256:createHash('sha256').update(sql).digest('hex')};});
 return{version:2,schemaVersion,source:{project:'jolly-scene-02112141',branch:'br-jolly-fire-b4klddds',database:'musitu_whatsapp_phase1'},migrations,data:Object.fromEntries(tables.map(n=>[n,[]])),applicationKeys:{contentEncryptionKey:randomBytes(32).toString('base64'),sessionEncryptionKey:randomBytes(32).toString('base64')}};
}
test('current-schema envelope accepts all 17 source migrations and the exact 22-table inventory',()=>{
 const data=fixture(),backupKey=randomBytes(32);
 data.data['musitu.outbound_attempts']=[{status:'UNKNOWN',dev_request_key:'synthetic_recovery',dev_body_digest:'a'.repeat(64)}];
 data.data['musitu.customer_suppressions']=[{reason:'SYNTHETIC_STOP'}];
 const encrypted=sealPostgresBackup({data,backupKey});
 assert.deepEqual(openPostgresBackup({encrypted,backupKey}),data);
 assert.equal(encrypted.includes(Buffer.from('synthetic_recovery')),false);
});
test('current-schema envelope rejects missing or substituted tables and invalid migration provenance',()=>{
 const backupKey=randomBytes(32);
 const bad=[];
 let d=fixture();delete d.data['musitu.customer_suppressions'];bad.push(d);
 d=fixture();delete d.data['musitu.customer_suppressions'];d.data['musitu.unrelated']=[];bad.push(d);
 d=fixture();d.migrations.pop();bad.push(d);
 d=fixture();d.migrations.reverse();bad.push(d);
 d=fixture();d.migrations[14]={...d.migrations[13]};bad.push(d);
 d=fixture();d.migrations[14].sql+='\n-- altered';bad.push(d);
 d=fixture();d.schemaVersion=18;bad.push(d);
 d=fixture();d.version=3;bad.push(d);
 for(const data of bad)assert.throws(()=>sealPostgresBackup({data,backupKey}),/BACKUP_PAYLOAD_REJECTED/);
});

test('existing schema-15 and schema-16 encrypted backups remain readable with schema-17 support',()=>{
 for(const version of [15,16]){const data=fixture(version),backupKey=randomBytes(32);assert.deepEqual(openPostgresBackup({encrypted:sealPostgresBackup({data,backupKey}),backupKey}),data);}
});
