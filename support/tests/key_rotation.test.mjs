import assert from 'node:assert/strict';
import test from 'node:test';
import {rotateSupportDataKey} from '../scripts/verify_support_key_rotation.mjs';

function response(status,payload){return {ok:status>=200&&status<300,status,async json(){return payload;}};}

test('empty non-public support control plane rotates only the data key without exposing it', async()=>{
  const calls=[];
  let keySecretPresent=true;
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url); const method=options.method||'GET';
    const body=options.body?JSON.parse(options.body):undefined;
    calls.push({method,path:u.pathname+u.search,body});
    if(u.pathname.endsWith('/workers/domains')&&method==='GET') return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/workers/scripts/musitu-axiom-support/subdomain')&&method==='GET') return response(200,{success:true,result:{enabled:false,previews_enabled:false}});
    if(u.pathname.includes('/dns_records')&&method==='GET') return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/d1/database/support-db/query')&&method==='POST'){
      const sql=String(body.sql||'');
      if(sql.includes('support_cases')) return response(200,{success:true,result:[{results:[{count:0}]}]});
      if(sql.includes('support_case_events')) return response(200,{success:true,result:[{results:[{count:0}]}]});
    }
    if(u.pathname.endsWith('/workers/scripts/musitu-axiom-support/secrets')&&method==='GET'){
      return response(200,{success:true,result:keySecretPresent?[{name:'SUPPORT_DATA_KEY_B64',type:'secret_text'},{name:'TURNSTILE_SECRET_KEY',type:'secret_text'}]:[]});
    }
    if(u.pathname.endsWith('/workers/scripts/musitu-axiom-support/secrets')&&method==='PUT'){
      assert.equal(body.name,'SUPPORT_DATA_KEY_B64');
      assert.equal(body.type,'secret_text');
      assert.equal(Buffer.from(body.text,'base64').length,32);
      keySecretPresent=true;
      return response(200,{success:true,result:{name:'SUPPORT_DATA_KEY_B64',type:'secret_text'}});
    }
    throw new Error(`unexpected ${method} ${u.pathname}`);
  };

  const evidence=await rotateSupportDataKey({
    fetchImpl,
    env:{
      GITHUB_REF_NAME:'support/axiom-official-support-20261005',
      GITHUB_REPOSITORY:'evansmusitu/mft-axiom-build',
      GITHUB_RUN_ID:'123',
      CLOUDFLARE_ACCOUNT_ID:'acct',
      CLOUDFLARE_ZONE_ID:'zone',
      SUPPORT_D1_DATABASE_ID:'support-db',
      CLOUDFLARE_API_TOKEN:'masked-token',
      SUPPORT_KEY_ROTATION_CONFIRM:'ROTATE_MUSITU_AXIOM_SUPPORT_DATA_KEY_EMPTY_D1',
    },
    now:'2026-10-06T06:30:00Z',
  });
  assert.equal(evidence.gate,'ENCRYPTION_KEY_MANAGEMENT');
  assert.equal(evidence.status,'PASS');
  assert.equal(evidence.rotation_performed,true);
  assert.equal(evidence.database_empty_verified,true);
  assert.equal(evidence.public_route_absent_verified,true);
  assert.equal(evidence.generated_key_bytes,32);
  assert.equal(evidence.secret_value_exposed,false);
  assert.equal(evidence.customer_data_reencrypted,false);
  assert.equal(calls.filter(c=>c.method==='PUT'&&c.path.endsWith('/secrets')).length,1);
  assert.equal(JSON.stringify(evidence).includes('masked-token'),false);
});

test('key rotation fails closed before write when support data exists', async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url); const method=options.method||'GET'; const body=options.body?JSON.parse(options.body):undefined;
    calls.push({method,path:u.pathname,body});
    if(u.pathname.endsWith('/workers/domains')) return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/workers/scripts/musitu-axiom-support/subdomain')) return response(200,{success:true,result:{enabled:false,previews_enabled:false}});
    if(u.pathname.includes('/dns_records')) return response(200,{success:true,result:[]});
    if(u.pathname.endsWith('/workers/scripts/musitu-axiom-support/secrets')&&method==='GET') {
      return response(200,{success:true,result:[{name:'SUPPORT_DATA_KEY_B64',type:'secret_text'},{name:'TURNSTILE_SECRET_KEY',type:'secret_text'}]});
    }
    if(u.pathname.endsWith('/query')){
      const sql=String(body.sql||'');
      const count=sql.includes('support_cases')?1:0;
      return response(200,{success:true,result:[{results:[{count}]}]});
    }
    throw new Error('unexpected');
  };
  await assert.rejects(()=>rotateSupportDataKey({
    fetchImpl,
    env:{
      GITHUB_REF_NAME:'support/axiom-official-support-20261005',
      CLOUDFLARE_ACCOUNT_ID:'acct',CLOUDFLARE_ZONE_ID:'zone',SUPPORT_D1_DATABASE_ID:'support-db',
      CLOUDFLARE_API_TOKEN:'masked-token',
      SUPPORT_KEY_ROTATION_CONFIRM:'ROTATE_MUSITU_AXIOM_SUPPORT_DATA_KEY_EMPTY_D1',
    }
  }),/support D1 must be empty/);
  assert.equal(calls.some(c=>c.method==='PUT'),false);
});
