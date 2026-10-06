import assert from 'node:assert/strict';
import test from 'node:test';
import {migrateRetentionSchema} from '../scripts/migrate_retention_schema.mjs';

function response(status,payload){return {ok:status>=200&&status<300,status,async json(){return payload;}};}

test('retention migration alters only an empty non-public support D1 and verifies lifecycle objects', async()=>{
  const calls=[]; const columns=new Set(['case_id','state','retention_class','last_event_hash','created_at','updated_at']);
  const objects=new Set(['support_cases','support_case_events','support_case_event_no_update','support_case_event_no_delete']);
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url); const method=options.method||'GET'; const body=options.body?JSON.parse(options.body):undefined;
    calls.push({method,path:u.pathname+u.search,body});
    if(u.pathname.endsWith('/workers/domains')) return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/workers/scripts/musitu-axiom-support/subdomain')) return response(200,{success:true,result:{enabled:false,previews_enabled:false}});
    if(u.pathname.includes('/dns_records')) return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/time_travel/bookmark')&&method==='GET') return response(200,{success:true,result:{bookmark:'before-retention'}});
    if(u.pathname.endsWith('/query')&&method==='POST'){
      const sql=String(body.sql||'');
      if(sql==='SELECT COUNT(*) AS count FROM support_cases;') return response(200,{success:true,result:[{results:[{count:0}]}]});
      if(sql==='SELECT COUNT(*) AS count FROM support_case_events;') return response(200,{success:true,result:[{results:[{count:0}]}]});
      if(sql==='PRAGMA table_info(support_cases);') return response(200,{success:true,result:[{results:[...columns].map((name,cid)=>({cid,name}))}]});
      if(sql.includes("SELECT type,name FROM sqlite_master")) return response(200,{success:true,result:[{results:[...objects].map(name=>({type:name.includes('trigger')||name.includes('no_')?'trigger':'table',name}))}]});
      if(sql.startsWith('ALTER TABLE support_cases ADD COLUMN ')){ columns.add(sql.split(' ')[6]); return response(200,{success:true,result:[{success:true}]}); }
      if(sql.startsWith('CREATE TABLE IF NOT EXISTS support_case_purge_authorizations')){objects.add('support_case_purge_authorizations');return response(200,{success:true,result:[{success:true}]});}
      if(sql.startsWith('CREATE TABLE IF NOT EXISTS support_deletion_receipts')){objects.add('support_deletion_receipts');return response(200,{success:true,result:[{success:true}]});}
      if(sql.startsWith('DROP TRIGGER IF EXISTS support_case_event_no_delete')){objects.delete('support_case_event_no_delete');return response(200,{success:true,result:[{success:true}]});}
      if(sql.startsWith('CREATE TRIGGER support_case_event_no_delete')){objects.add('support_case_event_no_delete');return response(200,{success:true,result:[{success:true}]});}
      if(sql.startsWith('CREATE TRIGGER IF NOT EXISTS support_case_no_delete')){objects.add('support_case_no_delete');return response(200,{success:true,result:[{success:true}]});}
      if(sql.startsWith('CREATE TRIGGER IF NOT EXISTS support_deletion_receipt_no_update')){objects.add('support_deletion_receipt_no_update');return response(200,{success:true,result:[{success:true}]});}
      if(sql.startsWith('CREATE TRIGGER IF NOT EXISTS support_deletion_receipt_no_delete')){objects.add('support_deletion_receipt_no_delete');return response(200,{success:true,result:[{success:true}]});}
      if(sql.startsWith('CREATE INDEX IF NOT EXISTS')) return response(200,{success:true,result:[{success:true}]});
      throw new Error('unexpected SQL: '+sql);
    }
    throw new Error(`unexpected ${method} ${u.pathname}`);
  };

  const evidence=await migrateRetentionSchema({
    fetchImpl,
    env:{
      GITHUB_REF_NAME:'support/axiom-official-support-20261005',
      GITHUB_RUN_ID:'123',
      CLOUDFLARE_ACCOUNT_ID:'acct',CLOUDFLARE_ZONE_ID:'zone',SUPPORT_D1_DATABASE_ID:'db',
      CLOUDFLARE_API_TOKEN:'masked-token',
      SUPPORT_RETENTION_MIGRATION_CONFIRM:'MIGRATE_MUSITU_AXIOM_SUPPORT_RETENTION_SCHEMA',
    },
    now:'2026-10-06T07:20:00Z',
  });
  assert.equal(evidence.gate,'PRIVACY_RETENTION_SCHEMA');
  assert.equal(evidence.status,'PASS');
  assert.equal(evidence.support_case_count_before,0);
  assert.equal(evidence.support_event_count_before,0);
  assert.equal(evidence.public_route_absent_verified,true);
  for(const name of ['closed_at','retention_expires_at','legal_hold_until','legal_hold_review_at']) assert.ok(columns.has(name));
  for(const name of ['support_case_purge_authorizations','support_deletion_receipts','support_case_no_delete','support_deletion_receipt_no_update','support_deletion_receipt_no_delete']) assert.ok(objects.has(name));
  assert.equal(calls.some(c=>c.path.includes('/time_travel/restore')),false);
});

test('retention migration fails before write when support cases exist', async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url); const method=options.method||'GET'; const body=options.body?JSON.parse(options.body):undefined;
    calls.push({method,path:u.pathname+u.search,body});
    if(u.pathname.endsWith('/workers/domains')) return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/workers/scripts/musitu-axiom-support/subdomain')) return response(200,{success:true,result:{enabled:false,previews_enabled:false}});
    if(u.pathname.includes('/dns_records')) return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/query')){
      const sql=String(body.sql||'');
      if(sql.includes('support_cases')) return response(200,{success:true,result:[{results:[{count:1}]}]});
      if(sql.includes('support_case_events')) return response(200,{success:true,result:[{results:[{count:0}]}]});
    }
    throw new Error('unexpected');
  };
  await assert.rejects(()=>migrateRetentionSchema({
    fetchImpl,
    env:{GITHUB_REF_NAME:'support/axiom-official-support-20261005',CLOUDFLARE_ACCOUNT_ID:'acct',CLOUDFLARE_ZONE_ID:'zone',SUPPORT_D1_DATABASE_ID:'db',CLOUDFLARE_API_TOKEN:'token',SUPPORT_RETENTION_MIGRATION_CONFIRM:'MIGRATE_MUSITU_AXIOM_SUPPORT_RETENTION_SCHEMA'}
  }),/requires zero support cases and events/);
  assert.equal(calls.some(c=>String(c.body?.sql||'').startsWith('ALTER TABLE')),false);
});
