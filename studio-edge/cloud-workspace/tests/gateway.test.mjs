import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {workspaceFetch,validOpaqueEnvelope} from '../gateway.mjs';
globalThis.crypto??=webcrypto;
const ORIGIN='https://workspace.mftintelligence.com';
const URL=ORIGIN+'/api/workspace/v1/tenants/enterprise-abc/slots/1';
const json=(v)=>JSON.stringify(v);
const b64=byteCount=>Buffer.from(Array.from({length:byteCount},(_,i)=>i%256)).toString('base64');
const ciphertext=json({kind:'musitu-local-encrypted-workspace',version:1,cipher:'AES-256-GCM',
  kdf:'PBKDF2-SHA-256',iterations:310000,salt:b64(16),iv:b64(12),ciphertext:b64(110)});
const req=(method='GET',url=URL,body=null,headers={})=>new Request(url,{method,headers:{origin:ORIGIN,
  'cf-access-jwt-assertion':'sample-access-token',...(body?{'content-type':'application/json'}:{}),...headers},
  ...(body?{body:json(body)}:{})});
class D1Mock{
  constructor(){this.memberships=new Map();this.slots=new Map();this.queries=[];}
  provision(tenant,sub,role){this.memberships.set(tenant+'|'+sub,role);}
  prepare(sql){
    assert.ok(sql.includes('tenant_id'), 'Every database query must tenant-scope its operations');
    return {bind:(...bind)=>({
      first:async()=>{
        this.queries.push({sql,bind});
        if(sql.startsWith('SELECT role')){
          const role=this.memberships.get(bind[0]+'|'+bind[1]);return role?{role}:null;
        }
        if(sql.startsWith('SELECT version')){
          const role=this.memberships.get(bind[2]+'|'+bind[3]);
          return role?this.slots.get(bind[0]+'|'+bind[1])??null:null;
        }
        throw Error('Unexpected SELECT');
      },
      run:async()=>{
        this.queries.push({sql,bind});
        if(sql.startsWith('INSERT INTO')){
          const [tenant,slot,encrypted,updated,scope,sub]=bind;
          const key=tenant+'|'+slot,role=this.memberships.get(scope+'|'+sub);
          if(role!=='owner'&&role!=='editor'||this.slots.has(key))return {success:true,meta:{changes:0}};
          this.slots.set(key,{version:1,encrypted,updated_at:updated});
          return {success:true,meta:{changes:1}};
        }
        if(sql.startsWith('UPDATE')){
          const [encrypted,updated,tenant,slot,version,scope,sub]=bind;
          const key=tenant+'|'+slot,role=this.memberships.get(scope+'|'+sub),current=this.slots.get(key);
          if((role!=='owner'&&role!=='editor')||!current||current.version!==version)return {success:true,meta:{changes:0}};
          this.slots.set(key,{version:current.version+1,encrypted,updated_at:updated});
          return {success:true,meta:{changes:1}};
        }
        if(sql.startsWith('DELETE')){
          const [tenant,slot,version,scope,sub]=bind;
          const key=tenant+'|'+slot,role=this.memberships.get(scope+'|'+sub),current=this.slots.get(key);
          if((role!=='owner'&&role!=='editor')||!current||current.version!==version)return {success:true,meta:{changes:0}};
          this.slots.delete(key);return {success:true,meta:{changes:1}};
        }
        throw Error('Unexpected SQL');
      }
    })};
  }
}
function mock(subject='identity-1234'){
  const db=new D1Mock();db.provision('enterprise-abc',subject,'owner');
  const env={WORKSPACE_ENABLED:'true',WORKSPACE_ORIGIN:ORIGIN,ACCESS_TEAM_DOMAIN:'https://team.cloudflareaccess.com',
    ACCESS_AUD:'qualified_app_aud',WORKSPACE_DB:db,WORKSPACE_RATE:{limit:async()=>({success:true})}};
  const handler=(request,extra={})=>workspaceFetch(request,{...env,...extra},{verifyJWT:async()=>({subject})});
  return {db,env,handler};
}
test('cloud sync feature remains disabled by default or missing Access, D1 and rate binding',async()=>{
  const {env}=mock();
  for(const overrides of [{WORKSPACE_ENABLED:'false'},{WORKSPACE_ORIGIN:'https://evansmusitu.github.io'},
    {WORKSPACE_ORIGIN:undefined},{WORKSPACE_DB:null},
    {ACCESS_AUD:''},{WORKSPACE_RATE:undefined},{ACCESS_TEAM_DOMAIN:'https://fake.invalid'}]){
    const r=await workspaceFetch(req(),{...env,...overrides});
    assert.equal(r.status,503);
    assert.equal((await r.json()).code,'WORKSPACE_NOT_CONFIGURED');
  }
});
test('metadata and CORS cannot grant an unauthenticated visitor access',async()=>{
  const {env,handler}=mock();
  const actual=await workspaceFetch(req(),env);
  assert.equal(actual.status,401);
  assert.equal((await handler(req('GET',URL,null,{origin:'https://evil.example'}))).status,403);
  assert.equal((await handler(req('GET',URL.replace('/slots/1','/slots/6')))).status,404);
  const preflight=await handler(req('OPTIONS'));
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),ORIGIN);
});
test('opaque envelope rejects plaintext and malformed crypto materials',()=>{
  assert.equal(validOpaqueEnvelope(ciphertext),true);
  for(const sample of [null,'hello there',json({transcript:[{role:'user',content:'private'}]}),
    ciphertext.replace('AES-256-GCM','AES-256-CBC'),
    ciphertext.replace('310000','300'),
    json({...JSON.parse(ciphertext),rawPlaintext:'unprotected'}),
    json({...JSON.parse(ciphertext),salt:b64(8)}),
    json({...JSON.parse(ciphertext),ciphertext:b64(4)})])assert.equal(validOpaqueEnvelope(sample),false);
});
test('authorized owner can create, retrieve, update and delete only encrypted slot with optimistic locking',async()=>{
  const {handler,db}=mock();
  assert.equal((await handler(req('GET'))).status,404);
  const save=await handler(req('PUT',URL,{expectedVersion:0,encrypted:ciphertext}));
  assert.equal(save.status,200);assert.equal((await save.json()).version,1);
  const get=await handler(req());
  assert.equal(get.status,200);const body=await get.json();
  assert.equal(body.encrypted,ciphertext);assert.equal(body.version,1);
  assert.equal(body.tenant,'enterprise-abc');
  assert.ok(!json(body).includes('plaintext'));
  assert.equal((await handler(req('PUT',URL,{expectedVersion:0,encrypted:ciphertext}))).status,409);
  assert.equal((await handler(req('PUT',URL,{expectedVersion:1,encrypted:ciphertext}))).status,200);
  assert.equal((await handler(req('DELETE',URL,{expectedVersion:1}))).status,409);
  assert.equal((await handler(req('DELETE',URL,{expectedVersion:2}))).status,200);
  assert.equal((await handler(req())).status,404);
  assert.ok(db.queries.every(({sql})=>sql.includes('tenant_id')));
  assert.ok(db.queries.filter(({sql})=>/^(INSERT|UPDATE|DELETE)/.test(sql)).every(({sql})=>sql.includes('EXISTS (SELECT 1 FROM workspace_memberships')));
});
test('tenant memberships enforce read and write RBAC, no cross-tenant enumeration',async()=>{
  const {db,env}=mock('user-owner-1234');
  const by=(subject,method='GET',url=URL,body=null)=>workspaceFetch(req(method,url,body),env,{verifyJWT:async()=>({subject})});
  await by('user-owner-1234','PUT',URL,{expectedVersion:0,encrypted:ciphertext});
  db.provision('enterprise-abc','viewer-1234','viewer');
  assert.equal((await by('viewer-1234')).status,200);
  assert.equal((await by('viewer-1234','PUT',URL,{expectedVersion:1,encrypted:ciphertext})).status,403);
  assert.equal((await by('viewer-1234','DELETE',URL,{expectedVersion:1})).status,403);
  assert.equal((await by('unrelated-user')).status,403);
  assert.equal((await by('user-owner-1234','GET',URL.replace('enterprise-abc','other-tenant'))).status,403);
});
test('revoke membership between authorization and SQL write prevents stale write permission',async()=>{
  const {env,db,handler}=mock();
  const original=db.prepare.bind(db);
  db.prepare=(sql)=>{
    const statement=original(sql);
    if(sql.startsWith('SELECT role')){
      const oldBind=statement.bind;
      statement.bind=(...args)=>{
        const bound=oldBind(...args);
        const oldFirst=bound.first;
        bound.first=async()=>{const found=await oldFirst();db.memberships.delete(args[0]+'|'+args[1]);return found;};
        return bound;
      };
    }
    return statement;
  };
  assert.equal((await handler(req('PUT',URL,{expectedVersion:0,encrypted:ciphertext}))).status,409);
  assert.equal(db.slots.size,0);
});
test('membership revocation between authorization and encrypted GET fails closed',async()=>{
  const {db,handler}=mock();
  const saved=await handler(req('PUT',URL,{expectedVersion:0,encrypted:ciphertext}));
  assert.equal(saved.status,200);
  const original=db.prepare.bind(db);
  db.prepare=(sql)=>{
    const st=original(sql);
    if(sql.startsWith('SELECT role')){
      const originalBind=st.bind;
      st.bind=(...args)=>{
        const bound=originalBind(...args),prior=bound.first;
        bound.first=async()=>{const result=await prior();db.memberships.delete(args[0]+'|'+args[1]);return result;};
        return bound;
      };
    }
    return st;
  };
  assert.equal((await handler(req())).status,404);
});
test('role change to viewer between authorization and SQL write fails closed',async()=>{
  const {env,db,handler}=mock();
  const original=db.prepare.bind(db);
  db.prepare=(sql)=>{
    const statement=original(sql);
    if(sql.startsWith('SELECT role')){
      const oldBind=statement.bind;
      statement.bind=(...args)=>{
        const bound=oldBind(...args),first=bound.first;
        bound.first=async()=>{const row=await first();db.provision(args[0],args[1],'viewer');return row;};
        return bound;
      };
    }
    return statement;
  };
  assert.equal((await handler(req('PUT',URL,{expectedVersion:0,encrypted:ciphertext}))).status,409);
  assert.equal(db.slots.size,0);
});
test('invalid JSON, body limits, missing version and cleartext uploads reject without storage',async()=>{
  const {handler,db}=mock();
  const examples=[
    [req('PUT',URL,{expectedVersion:0,encrypted:'raw secret'}),400],
    [req('PUT',URL,{expectedVersion:0,encrypted:ciphertext,content:'secret'}),400],
    [req('PUT',URL,{encrypted:ciphertext}),400],
    [req('PUT',URL,{expectedVersion:-1,encrypted:ciphertext}),400],
    [req('PUT',URL,{expectedVersion:0,encrypted:ciphertext},{'content-type':'text/plain'}),415],
    [req('PUT',URL,{expectedVersion:0,encrypted:ciphertext},{'content-length':'99999999'}),413],
    [req('DELETE',URL,{expectedVersion:0}),400]
  ];
  for(const [request,status] of examples){const result=await handler(request);assert.equal(result.status,status);}
  assert.equal(db.slots.size,0);
});
test('denied rate limit and D1 outage do not fall back to untrusted client storage',async()=>{
  const {handler}=mock();
  assert.equal((await handler(req(),{WORKSPACE_RATE:{limit:async()=>({success:false})}})).status,429);
  assert.equal((await handler(req(),{WORKSPACE_RATE:{limit:async()=>{throw Error('disconnected');}}})).status,429);
  assert.equal((await handler(req(),{WORKSPACE_DB:{prepare(){throw Error('disconnected');}}})).status,503);
});
test('response disallows caches and extra origin, and only five slot routes exist',async()=>{
  const {handler}=mock();
  for(let slot=1;slot<=5;slot++){
    const r=await handler(req('GET',URL.replace('/slots/1','/slots/'+slot)));
    assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');
    assert.equal(r.headers.get('access-control-allow-origin'),ORIGIN);
  }
  assert.equal((await handler(req('GET',URL.replace('/slots/1','/slots/0')))).status,404);
  assert.equal((await handler(req('GET',URL.replace('/slots/1','/slots/10')))).status,404);
});

test('first-party workspace origin cannot be confused with public GitHub Pages or workers.dev',async()=>{
  const {handler}=mock();
  assert.equal((await handler(req('GET',URL.replace('workspace.mftintelligence.com','evil.workers.dev')))).status,403);
  assert.equal((await handler(req('GET',URL,null,{origin:'https://evansmusitu.github.io'}))).status,403);
  const getWithoutOrigin = new Request(URL,{headers:{'cf-access-jwt-assertion':'sample-access-token'}});
  assert.equal((await handler(getWithoutOrigin)).status,404,'First-party GET can lack an Origin header');
  const hostileMutation = new Request(URL,{method:'PUT',headers:{'cf-access-jwt-assertion':'sample-access-token',
    'content-type':'application/json'},body:JSON.stringify({expectedVersion:0,encrypted:ciphertext})});
  assert.equal((await handler(hostileMutation)).status,403,'State-changing calls always require an Origin');
});
