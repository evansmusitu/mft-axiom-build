/** Disposable native PostgreSQL qualification; NEVER a hosted or real send.
 * Requires a separately launched, fresh loopback PostgreSQL service and
 * PG_ISOLATED_QUALIFICATION=YES. Creates then drops musitu_phase1_sender_ci
 * and the four fixture roles. Refuses pre-existing database/roles. No fetch
 * is used: the real sender's HTTP seam is an in-process, fixed-target fake.
 */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createDevelopmentReplySender} from '../src/staging/development-reply.mjs';
import {encryptLedger} from '../src/security/ledger-encryption.mjs';
import {createRuntimeRoleBoundPool} from '../src/postgres/runtime-role-guard.mjs';
import {qualifyCurrentSchemaRecovery} from './native-current-schema-recovery.mjs';
import {qualifyConversationPrivacy} from './native-conversation-privacy.mjs';

const raw=process.env.PG_ADMIN_URL||'';
let url;
try{url=new URL(raw);}catch{}
if(process.env.PG_ISOLATED_QUALIFICATION!=='YES'||!url||
 !['postgres:','postgresql:'].includes(url.protocol)||
 !['127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/postgres'||
 !url.port||Number(url.port)<1024||url.search||url.hash){
 console.error('BLOCKED: explicit isolated qualification and literal loopback postgres URL with a nonprivileged port required');
 process.exit(78);
}
const {default:pg}=await import('pg');
const {Client,Pool}=pg;
const database='musitu_phase1_sender_ci';
const roleNames=['musitu_migrator','musitu_runtime','musitu_ingress','musitu_commands'];
const tenant='986eb904-7296-46a9-9e9b-94074db9b547',owner='395558180472062118';
const phone='1292923853915392',waba='1955690452095441',recipient='19999990001';
const key=randomBytes(32),body='Synthetic native concurrency qualification; never transmitted.';
const digest=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const connection=(dbname,user,password)=>{
 const value=new URL(raw);value.pathname='/'+dbname;
 if(user)value.username=user;if(password!==undefined)value.password=password;
 return value.href;
};
const admin=new Client({connectionString:raw,connectionTimeoutMillis:3000});
let dbCreated=false,seed,migration,pool,runtimePassword;
const createdRoles=[],results=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function bounded(promise,label){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('QUALIFICATION_TIMEOUT:'+label)),5000);})]);}
 finally{clearTimeout(timer);}
}
function newPool(){
 pool=new Pool({connectionString:connection(database,'musitu_runtime',runtimePassword),max:12,
  connectionTimeoutMillis:3000,statement_timeout:4000,query_timeout:5000});
 pool.on('error',()=>{});
 return createRuntimeRoleBoundPool({pool,expectedRole:'musitu_runtime'});
}
let guarded;
async function scoped(scope,actor,roles,work){
 const client=await guarded.connect();let discard;
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('app.tenant_id',$1,true)",[scope]);
  const {rows}=await client.query("SELECT role FROM musitu.memberships WHERE tenant_id=$1 AND actor_id=$2 AND status='ACTIVE'",[scope,actor]);
  if(rows.length!==1||!roles.includes(rows[0].role))throw Error('ACCESS_DENIED');
  const result=await work(client);await client.query('COMMIT');return result;
 }catch(error){try{await client.query('ROLLBACK');}catch(e){discard=e;}throw error;}
 finally{client.release(discard);}
}
async function fixtures(count=12){
 // Only this script-created disposable DB is reachable through seed.
 await seed.query('TRUNCATE musitu.tenants CASCADE');
 await seed.query("INSERT INTO musitu.tenants VALUES($1,'Synthetic concurrency fixture','ACTIVE')",[tenant]);
 await seed.query("INSERT INTO musitu.memberships VALUES($1,$2,'OWNER','ACTIVE')",[tenant,owner]);
 await seed.query("INSERT INTO musitu.whatsapp_channels VALUES($1,$2,$3,'VERIFIED')",[tenant,waba,phone]);
 const inputs=[];
 for(let i=0;i<count;i++){
  const conversationId=randomUUID(),messageId='wamid.NATIVE_'+i,remote='hmac256:'+digest('synthetic-contact-'+i);
  await seed.query("INSERT INTO musitu.conversations VALUES($1,$2,$3,$4,'HUMAN')",[tenant,conversationId,phone,remote]);
  await seed.query('INSERT INTO musitu.contacts VALUES($1,$2,$3,$4)',[tenant,phone,remote,encryptLedger(recipient,key,[tenant,phone,'contact:'+remote])]);
  await seed.query("INSERT INTO musitu.inbound_events(tenant_id,phone_number_id,provider_message_id,conversation_id,payload_fingerprint,provider_sent_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '1 minute')",[tenant,phone,messageId,conversationId,digest(messageId)]);
  await seed.query('INSERT INTO musitu.messages(tenant_id,phone_number_id,provider_message_id,conversation_id,encrypted_body) VALUES($1,$2,$3,$4,$5)',[tenant,phone,messageId,conversationId,encryptLedger('Synthetic inbound',key,[tenant,phone,messageId])]);
  inputs.push({tenantId:tenant,actorId:owner,conversationId,messageId,requestKey:'native_'+i,body,approveText:true,confirmOwnNumber:true,recheckSession:async()=>{}});
 }
 return inputs;
}
function transport({hold=false,uncertain=false}={}){
 const started=deferred(),release=deferred();let posts=0;
 const sender=createDevelopmentReplySender({scoped,enabled:true,contentKey:key,recipientSha256:digest(recipient),token:'EAA'+'N'.repeat(40),request:async(path,options)=>{
  if(options.method==='GET'&&path==='https://graph.facebook.com/v25.0/app?fields=id')return Response.json({id:'1096094346481018'});
  if(options.method==='GET'&&path===`https://graph.facebook.com/v25.0/${waba}/phone_numbers?fields=id`)return Response.json({data:[{id:phone}]});
  assert.equal(options.method,'POST');assert.equal(path,`https://graph.facebook.com/v25.0/${phone}/messages`);
  const payload=JSON.parse(options.body);assert.equal(payload.to,recipient);assert.equal(payload.text.body,body);
  posts++;
  // A DIFFERENT real connection must see the committed UNKNOWN reservation
  // before the transport seam can return any synthetic provider result.
  const rows=await seed.query("SELECT count(*)::int AS n FROM musitu.outbound_attempts WHERE status='UNKNOWN'");
  assert.equal(rows.rows[0].n,1,'only one committed UNKNOWN may reach transport');
  started.resolve();if(hold)await bounded(release.promise,'release transport');
  if(uncertain)throw Error('SYNTHETIC_CONNECTION_LOSS');
  return Response.json({messaging_product:'whatsapp',contacts:[{wa_id:recipient}],messages:[{id:'wamid.NATIVE_RESULT_'+posts}]});
 }});
 return{sender,started,release,get posts(){return posts;}};
}
async function race(inputs,expectedError){
 const http=transport({hold:true}),othersSettled=deferred();let settled=0;
 const runs=inputs.map(input=>http.sender(input).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason})).then(result=>{if(++settled>=inputs.length-1)othersSettled.resolve();return result;}));
 try{
  await bounded(http.started.promise,'transport start');
  await bounded(othersSettled.promise,'competing requests');
  assert.equal(http.posts,1,'racing approvals may reach transport once');
 }finally{http.release.resolve();}
 const outcomes=await Promise.all(runs);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled'&&!r.value.idempotent).length,1);
 if(expectedError){
  assert.equal(outcomes.filter(r=>r.status==='rejected').length,inputs.length-1);
  for(const r of outcomes.filter(r=>r.status==='rejected'))assert.match(r.reason.message,expectedError);
 }else{
  assert.equal(outcomes.filter(r=>r.status==='fulfilled'&&r.value.idempotent).length,inputs.length-1);
 }
 assert.equal(http.posts,1);
 const rows=await seed.query('SELECT count(*)::int AS n FROM musitu.outbound_attempts');assert.equal(rows.rows[0].n,1);
 return{contenders:inputs.length,syntheticPosts:http.posts,attemptRows:rows.rows[0].n};
}
async function check(name,run){const detail=await run();results.push({name,status:'PASS',detail});}
try{
 await admin.connect();
 assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0,'BLOCKED_EXISTING_TEST_DATABASE');
 assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname=ANY($1::text[])',[roleNames])).rowCount,0,'BLOCKED_EXISTING_TEST_ROLES');
 const passwords=new Map(roleNames.map(role=>[role,randomBytes(24).toString('hex')]));runtimePassword=passwords.get('musitu_runtime');
 for(const role of roleNames){await admin.query(`CREATE ROLE ${role} ${role==='musitu_commands'?'NOLOGIN':'LOGIN PASSWORD '+quote(passwords.get(role))} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);createdRoles.push(role);}
 await admin.query('GRANT musitu_commands TO musitu_migrator');
 await admin.query(`CREATE DATABASE ${database} OWNER musitu_migrator`);dbCreated=true;
 await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
 await admin.query(`GRANT CONNECT ON DATABASE ${database} TO musitu_runtime,musitu_ingress`);
 migration=new Client({connectionString:connection(database,'musitu_migrator',passwords.get('musitu_migrator'))});await migration.connect();
 const dbRoot=resolve(import.meta.dirname,'../db');
 const files=readdirSync(dbRoot).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort();
 assert.equal(files.length,15,'review migrations before expanding qualification');
 for(const file of files)await migration.query(readFileSync(resolve(dbRoot,file),'utf8'));
 await migration.end();migration=null;
 seed=new Client({connectionString:connection(database)});await seed.connect();guarded=newPool();
 await check('runtime_identity_and_no_direct_outbound_authority',async()=>{
  const client=await guarded.connect();try{
   const {rows}=await client.query("SELECT current_user AS role,rolsuper,rolbypassrls,has_any_column_privilege(current_user,'musitu.outbound_attempts','INSERT') AS insert_allowed FROM pg_roles WHERE rolname=current_user");
   assert.deepEqual(rows[0],{role:'musitu_runtime',rolsuper:false,rolbypassrls:false,insert_allowed:false});return rows[0];
  }finally{client.release();}
 });
 await check('ten_same_key_requests_one_committed_transport',async()=>{const f=await fixtures();return race(Array.from({length:10},()=>({...f[0]})));});
 await check('ten_keys_same_source_one_committed_transport',async()=>{const f=await fixtures();return race(Array.from({length:10},(_,i)=>({...f[0],requestKey:'conflict_'+i})),/^DEVELOPMENT_REPLY_CONFLICT$/);});
 await check('ten_conversations_share_uncertain_attempt_gate',async()=>{const f=await fixtures();return race(f.slice(0,10),/^DEVELOPMENT_UNCERTAIN_ATTEMPT$/);});
 await check('uncertain_transport_survives_new_pool_without_resend',async()=>{
  const f=await fixtures(),http=transport({uncertain:true});const result=await http.sender(f[0]);assert.equal(result.status,'UNKNOWN');
  await pool.end();guarded=newPool();
  const replay=await http.sender(f[0]);assert.equal(replay.idempotent,true);assert.equal(replay.status,'UNKNOWN');
  await assert.rejects(http.sender(f[1]),{message:'DEVELOPMENT_UNCERTAIN_ATTEMPT',code:'P0001'});assert.equal(http.posts,1);
  return{syntheticPosts:1,replayPosts:0,newPool:true};
 });
 await check('concurrent_daily_budget_never_exceeds_five',async()=>{
  const f=await fixtures(16),http=transport();
  for(const input of f.slice(0,4))assert.equal((await http.sender(input)).status,'ACCEPTED');
  const results=await Promise.allSettled(f.slice(4,14).map(input=>http.sender(input)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='fulfilled').value.status,'ACCEPTED');
  for(const result of results.filter(r=>r.status==='rejected'))assert.match(result.reason.message,/^DEVELOPMENT_(DAILY_LIMIT|UNCERTAIN_ATTEMPT)$/);
  assert.equal(http.posts,5);assert.equal((await seed.query("SELECT count(*)::int AS n FROM musitu.outbound_attempts WHERE status='ACCEPTED'")).rows[0].n,5);
  await assert.rejects(http.sender(f[15]),{message:'DEVELOPMENT_DAILY_LIMIT',code:'P0001'});assert.equal(http.posts,5);
  return{preexistingSyntheticAttempts:4,contenders:10,additionalSyntheticPosts:1,totalAttemptRows:5};
 });
 const recovery=process.env.PG_SCHEMA_RECOVERY_QUALIFICATION==='YES'?await qualifyCurrentSchemaRecovery({admin,seed,Client,connection,migrationPassword:passwords.get('musitu_migrator'),runtimePassword,dbRoot,files,contentKey:key}):null;
 const privacy=recovery?await qualifyConversationPrivacy({seed,pool,contentKey:key,tenant,owner,phone}):null;
 console.log(JSON.stringify({observedAt:new Date().toISOString(),scope:'DISPOSABLE_NATIVE_POSTGRES_REAL_SENDER_FAKE_HTTP_NO_META_NO_IDP',postgresVersion:(await seed.query('SHOW server_version')).rows[0].server_version,migrations:15,passed:results.length,failed:0,results,recovery,privacy,realMetaPosts:0,identityQualified:false,hostedDatabaseTouched:false}));
}finally{
 await pool?.end();await migration?.end();await seed?.end();
 if(dbCreated)await admin.query(`DROP DATABASE ${database}`);
 for(const role of createdRoles.reverse())await admin.query(`DROP ROLE ${role}`);
 await admin.end();
}
