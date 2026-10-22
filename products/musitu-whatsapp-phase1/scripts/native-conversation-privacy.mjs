/** Only invoked by the guarded disposable PostgreSQL qualifier. All test data is
 * synthetic, all callbacks simulate the session boundary, and no bundle is saved.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {createConversationPrivacyExporter,openConversationPrivacyExport} from '../src/postgres/conversation-privacy-export.mjs';
import {encryptLedger} from '../src/security/ledger-encryption.mjs';

export async function qualifyConversationPrivacy({seed,pool,contentKey,tenant,owner,phone}){
 const results=[];
 const check=async(name,run)=>{await run();results.push({name,status:'PASS'});};
 const target=(await seed.query("SELECT c.* FROM musitu.conversations c JOIN musitu.outbound_attempts a ON a.tenant_id=c.tenant_id AND a.dev_conversation_id=c.conversation_id WHERE a.status='UNKNOWN' ORDER BY c.conversation_id LIMIT 1")).rows[0];
 assert.ok(target,'SYNTHETIC_UNKNOWN_FIXTURE_REQUIRED');
 const conversationId=target.conversation_id,requestId='synthetic-privacy-request',exportKey=randomBytes(32);
 const scope={tenantId:tenant,actorId:owner,conversationId,requestId,exportKey,recheckSession:async()=>{}};
 const exporter=createConversationPrivacyExporter({pool,contentKey});
 const expired='wamid.PRIVACY_EXPIRED';
 await seed.query("INSERT INTO musitu.inbound_events(tenant_id,phone_number_id,provider_message_id,conversation_id,payload_fingerprint,provider_sent_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '31 days')",[tenant,phone,expired,conversationId,createHash('sha256').update(expired).digest('hex')]);
 await seed.query("INSERT INTO musitu.messages VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '1 day')",[tenant,phone,expired,conversationId,encryptLedger('Expired synthetic content must stay excluded',contentKey,[tenant,phone,expired])]);
 const foreignTenant=randomUUID(),foreignConversation=randomUUID(),foreignPhone='99999999001',foreignOwner='synthetic-foreign-owner';
 await seed.query("INSERT INTO musitu.tenants VALUES($1,'Synthetic other privacy tenant','ACTIVE')",[foreignTenant]);
 await seed.query("INSERT INTO musitu.memberships VALUES($1,$2,'OWNER','ACTIVE')",[foreignTenant,foreignOwner]);
 await seed.query("INSERT INTO musitu.whatsapp_channels VALUES($1,'99999999002',$2,'VERIFIED')",[foreignTenant,foreignPhone]);
 await seed.query("INSERT INTO musitu.conversations VALUES($1,$2,$3,$4,'HUMAN')",[foreignTenant,foreignConversation,foreignPhone,'hmac256:'+'a'.repeat(64)]);
 const other=(await seed.query('SELECT conversation_id FROM musitu.conversations WHERE tenant_id=$1 AND conversation_id<>$2 ORDER BY conversation_id LIMIT 1',[tenant,conversationId])).rows[0].conversation_id;
 // Include linked development reply/receipt/consent/suppression in a real export.
 await seed.query("INSERT INTO musitu.customer_suppressions(tenant_id,conversation_id,phone_number_id,remote_wa_id,source_provider_message_id) VALUES($1,$2,$3,$4,'wamid.PRIVACY_STOP') ON CONFLICT DO NOTHING",[tenant,conversationId,phone,target.remote_wa_id]);
 await seed.query("INSERT INTO musitu.message_status_events(tenant_id,phone_number_id,provider_message_id,status,provider_timestamp,payload_fingerprint) SELECT tenant_id,channel_phone_number_id,provider_message_id,'SENT',clock_timestamp(),$3 FROM musitu.outbound_attempts WHERE tenant_id=$1 AND dev_conversation_id=$2 AND provider_message_id IS NOT NULL",[tenant,conversationId,'b'.repeat(64)]);
 const preservation=async()=>{
  const names=['outbound_attempts','customer_suppressions','channel_consent_evidence','messages'];
  const state=[];for(const name of names)state.push((await seed.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM musitu.${name} t`)).rows[0].rows);
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
 };
 let bundle;
 await check('owner_single_conversation_encrypted_export_preserves_protected_records',async()=>{
  const before=await preservation();let rechecks=0;
  bundle=await exporter({...scope,recheckSession:async()=>{rechecks++;}});
  const plain=openConversationPrivacyExport({...scope,encrypted:bundle.encrypted});
  assert.equal(rechecks,2);assert.equal(plain.recipient,'19999990001');
  assert.equal(plain.data.messages.length,2);
  assert.equal(plain.data.messages.find(r=>r.provider_message_id===expired).body,null);
  assert.equal(plain.data.messages.find(r=>r.provider_message_id!==expired).body,'Synthetic inbound');
  assert.equal(plain.data.attempts.length,1);assert.equal(plain.data.attempts[0].status,'UNKNOWN');
  assert.equal(plain.data.attempts[0].body,'Synthetic native concurrency qualification; never transmitted.');
  assert.equal(plain.data.receipts.length,1);assert.equal(plain.data.consent.length,1);assert.equal(plain.data.suppression.length,1);
  assert.equal(bundle.encrypted.includes(Buffer.from('Synthetic inbound')),false);
  const serialized=JSON.stringify(plain);assert.equal(serialized.includes(other),false);assert.equal(serialized.includes(foreignTenant),false);
  assert.equal(serialized.includes('encrypted_body'),false);assert.equal(serialized.includes(contentKey.toString('base64')),false);
  assert.equal(bundle.receipt.delivered,false);assert.equal(bundle.receipt.erased,false);
  assert.equal(await preservation(),before);
 });
 await check('bundle_rejects_tamper_wrong_key_request_and_scope',async()=>{
  const tampered=Buffer.from(bundle.encrypted);tampered[tampered.length-1]^=1;
  for(const patch of [{encrypted:tampered},{exportKey:randomBytes(32)},{tenantId:foreignTenant},{conversationId:other},{requestId:'different-request'}]){
   assert.throws(()=>openConversationPrivacyExport({...scope,encrypted:bundle.encrypted,...patch}),{message:'PRIVACY_EXPORT_OPEN_REJECTED'});
  }
 });
 await check('foreign_conversation_tenant_and_owner_denied',async()=>{
  await assert.rejects(exporter({...scope,conversationId:foreignConversation}),{message:'PRIVACY_CONVERSATION_UNAVAILABLE'});
  await assert.rejects(exporter({...scope,tenantId:foreignTenant,conversationId:foreignConversation}),{message:'ACCESS_DENIED'});
  await assert.rejects(exporter({...scope,actorId:foreignOwner}),{message:'ACCESS_DENIED'});
 });
 await check('agent_viewer_and_revoked_owner_denied',async()=>{
  for(const [actor,role,status] of [['synthetic-agent','AGENT','ACTIVE'],['synthetic-viewer','VIEWER','ACTIVE'],['synthetic-revoked','OWNER','REVOKED']]){
   await seed.query('INSERT INTO musitu.memberships VALUES($1,$2,$3,$4)',[tenant,actor,role,status]);
   await assert.rejects(exporter({...scope,actorId:actor}),{message:'ACCESS_DENIED'});
  }
 });
 await check('revocation_during_export_observed_before_release',async()=>{
  let calls=0;
  try{
   await assert.rejects(exporter({...scope,recheckSession:async()=>{if(++calls===2)await seed.query("UPDATE musitu.memberships SET status='REVOKED' WHERE tenant_id=$1 AND actor_id=$2",[tenant,owner]);}}),{message:'ACCESS_DENIED'});
   assert.equal(calls,2);
  }finally{await seed.query("UPDATE musitu.memberships SET status='ACTIVE' WHERE tenant_id=$1 AND actor_id=$2",[tenant,owner]);}
 });
 await check('expired_session_callback_denies_bundle_and_pool_recovers',async()=>{
  let calls=0;await assert.rejects(exporter({...scope,recheckSession:async()=>{if(++calls===2)throw Error('SYNTHETIC_SESSION_REVOKED');}}),{message:'PRIVACY_EXPORT_FAILED'});
  assert.ok((await exporter(scope)).encrypted.length>0);
 });
 await check('corrupt_ledger_rejects_entire_export_without_sensitive_diagnostics',async()=>{
  const row=(await seed.query('SELECT provider_message_id,encrypted_body FROM musitu.messages WHERE tenant_id=$1 AND conversation_id=$2 AND retained_until>now()',[tenant,conversationId])).rows[0];
  try{
   await seed.query("UPDATE musitu.messages SET encrypted_body='invalid-private-ciphertext' WHERE tenant_id=$1 AND provider_message_id=$2",[tenant,row.provider_message_id]);
   await assert.rejects(exporter(scope),{message:'PRIVACY_EXPORT_FAILED'});
  }finally{await seed.query('UPDATE musitu.messages SET encrypted_body=$3 WHERE tenant_id=$1 AND provider_message_id=$2',[tenant,row.provider_message_id,row.encrypted_body]);}
 });
 await check('oversized_conversation_denied_without_truncation_and_scope_cleared',async()=>{
  await seed.query("INSERT INTO musitu.inbound_events(tenant_id,phone_number_id,provider_message_id,conversation_id,payload_fingerprint,provider_sent_at) SELECT $1,$2,'wamid.PRIVACY_LIMIT_'||i,$3,repeat('c',64),clock_timestamp()-interval '31 days' FROM generate_series(1,1001) i",[tenant,phone,conversationId]);
  try{await assert.rejects(exporter(scope),{message:'PRIVACY_EXPORT_TOO_LARGE'});}
  finally{await seed.query("DELETE FROM musitu.inbound_events WHERE tenant_id=$1 AND provider_message_id LIKE 'wamid.PRIVACY_LIMIT_%'",[tenant]);}
  const client=await pool.connect();try{assert.equal((await client.query('SELECT count(*)::int AS n FROM musitu.messages')).rows[0].n,0);}finally{client.release();}
 });
 return{status:'PASS',scope:'NATIVE_SYNTHETIC_SINGLE_CONVERSATION_OPERATOR_EXPORT',passed:results.length,failed:0,results,realIdentityQualified:false,hostedDataExported:false,customerDeliveryQualified:false,deletionQualified:false};
}
