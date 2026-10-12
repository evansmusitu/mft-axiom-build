import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {MmfCommercialStageKernel,createMmfCommercialSqliteDb} from '../src/edge/mmf-commercial-private-stage.mjs';

const at=Date.UTC(2026,9,12,14,0,0);
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const tmp=mkdtempSync(join(tmpdir(),'mmf-private-stage-'));
 t.after(()=>rmSync(tmp,{recursive:true,force:true}));
 const path=join(tmp,'commercial.db');
 const oidc=generateKeyPairSync('rsa',{modulusLength:2048});
 const payments=generateKeyPairSync('ed25519');
 const publicJwk=oidc.publicKey.export({format:'jwk'});
 const env={
  MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',
  MMF_CUSTOMER_API_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false',
  MMF_OIDC_ISSUER:'https://login.example.org',MMF_OIDC_AUDIENCE:'mmf-stage-client',
  MMF_OIDC_KEY_ID:'test-key-20261012',MMF_OIDC_PUBLIC_JWK_JSON:JSON.stringify(publicJwk),
  MMF_OIDC_PINNED_SPKI_SHA256:hash(oidc.publicKey.export({type:'spki',format:'der'})),
  MMF_SESSION_PEPPER_B64:Buffer.alloc(32,44).toString('base64url'),
  MMF_API_PEPPER_B64:Buffer.alloc(32,45).toString('base64url'),
  MMF_PAYMENT_PUBLIC_KEY_PEM:payments.publicKey.export({type:'spki',format:'pem'}).toString()
 };
 function storage(){
  const db=new DatabaseSync(path);
  const sql={exec(query,...params){
   if(query.trim().startsWith('PRAGMA')||query.includes('CREATE TABLE')||query.includes('CREATE INDEX')){
    db.exec(query);return{toArray:()=>[]};
   }
   const stmt=db.prepare(query);
   const result=/^\s*(SELECT|PRAGMA)/i.test(query)?stmt.all(...params):stmt.run(...params);
   return {toArray:()=>Array.isArray(result)?result:[]};
  }};
  return {db,ctx:{storage:{sql,transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(err){db.exec('ROLLBACK');throw err;}}}}};
 }
 function token(nonce,sub='subject-tenant-operator'){
  const now=Math.floor(at/1000);
  const header={alg:'RS256',typ:'JWT',kid:env.MMF_OIDC_KEY_ID};
  const claims={iss:env.MMF_OIDC_ISSUER,aud:env.MMF_OIDC_AUDIENCE,sub,nonce,iat:now,exp:now+600};
  const payload=[header,claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return `${payload}.${sign('RSA-SHA256',Buffer.from(payload),oidc.privateKey).toString('base64url')}`;
 }
 return {env,storage,token};
}
test('durable identity sessions and tenant records survive object restart without crossing tenants',t=>{
 const f=fixture(t),one=f.storage();t.after(()=>{if(one.db.isOpen)one.db.close()});
 const server=new MmfCommercialStageKernel(one.ctx,f.env,{now:()=>at});
 const challenge=server.issueLoginChallenge();
 const login=server.acceptOidcLogin({nonce:challenge.nonce,idToken:f.token(challenge.nonce)});
 assert.equal(server.createTenant({sessionToken:login.sessionToken,tenantId:'org-alpha'}).tenantId,'org-alpha');
 const key=server.issueApiKey({sessionToken:login.sessionToken,tenantId:'org-alpha',scope:'billing:read'});
 assert.match(key.token,/^mmf_stage_/);
 const domain=server.requestDomain({sessionToken:login.sessionToken,tenantId:'org-alpha',domain:'notify.example.org'});
 assert.equal(domain.status,'PENDING_DNS');
 one.db.close();
 const two=f.storage();t.after(()=>two.db.close());
 const restarted=new MmfCommercialStageKernel(two.ctx,f.env,{now:()=>at+1000});
 assert.equal(restarted.getUsage({sessionToken:login.sessionToken,tenantId:'org-alpha'}).count,0);
 assert.equal(restarted.openSubscription({sessionToken:login.sessionToken,tenantId:'org-alpha',planCode:'LAUNCH',orderReference:'MMF-ORDER-ABCDEF12345'}).status,'PENDING');
 assert.equal(restarted.authenticateApiKey(key.token,'billing:read').tenantId,'org-alpha');
 assert.throws(()=>restarted.getUsage({sessionToken:login.sessionToken,tenantId:'org-other'}),/MMF_/);
 assert.equal(restarted.revokeSession(login.sessionToken),true);
 assert.throws(()=>restarted.getUsage({sessionToken:login.sessionToken,tenantId:'org-alpha'}),/MMF_/);
});
test('single-use OIDC nonce persists on restart and cannot be replayed',t=>{
 const f=fixture(t),a=f.storage();t.after(()=>{if(a.db.isOpen)a.db.close()});
 const first=new MmfCommercialStageKernel(a.ctx,f.env,{now:()=>at});
 const c=first.issueLoginChallenge();first.acceptOidcLogin({nonce:c.nonce,idToken:f.token(c.nonce)});
 a.db.close();const b=f.storage();t.after(()=>b.db.close());
 const second=new MmfCommercialStageKernel(b.ctx,f.env,{now:()=>at+1000});
 assert.throws(()=>second.acceptOidcLogin({nonce:c.nonce,idToken:f.token(c.nonce)}),/MMF_/);
});
test('fail-closed flags reject production-enabled configurations and all public requests',async t=>{
 const f=fixture(t),a=f.storage();t.after(()=>{if(a.db.isOpen)a.db.close()});
 assert.throws(()=>new MmfCommercialStageKernel(a.ctx,{...f.env,MMF_COMMERCE_ENABLED:'true'},{now:()=>at}),/MMF_/);
 const obj=new MmfCommercialStageKernel(a.ctx,f.env,{now:()=>at});
 const resp=await obj.fetch(new Request('https://mmf.invalid/health'));
 assert.equal(resp.status,503);
 assert.equal(resp.headers.get('cache-control'),'no-store');
 assert.equal(resp.headers.get('access-control-allow-origin'),null);
});
test('SQLite transaction adapter uses Cloudflare transactionSync instead of SQL BEGIN, and rolls back failed writes',t=>{
 const f=fixture(t),a=f.storage();t.after(()=>{if(a.db.isOpen)a.db.close()});
 const app=new MmfCommercialStageKernel(a.ctx,f.env,{now:()=>at});
 const c=app.issueLoginChallenge();const login=app.acceptOidcLogin({nonce:c.nonce,idToken:f.token(c.nonce)});
 app.createTenant({sessionToken:login.sessionToken,tenantId:'org-alpha'});
 const before=app.getUsage({sessionToken:login.sessionToken,tenantId:'org-alpha'});
 assert.throws(()=>app.meterStageEvent({sessionToken:login.sessionToken,tenantId:'org-alpha',idempotencyKey:'EVENT-123456789',kind:'forbidden'}),/MMF_/);
 assert.deepEqual(app.getUsage({sessionToken:login.sessionToken,tenantId:'org-alpha'}),before);
 assert.equal(app.meterStageEvent({sessionToken:login.sessionToken,tenantId:'org-alpha',idempotencyKey:'EVENT-123456789',kind:'governed'}).count,1);
 assert.equal(app.meterStageEvent({sessionToken:login.sessionToken,tenantId:'org-alpha',idempotencyKey:'EVENT-123456789',kind:'governed'}).duplicate,true);
});

test('durable stage refuses missing or reused secret peppers and never reveals checkout/sending rights',t=>{
 const f=fixture(t),a=f.storage();t.after(()=>a.db.close());
 assert.throws(()=>new MmfCommercialStageKernel(a.ctx,{...f.env,MMF_API_PEPPER_B64:f.env.MMF_SESSION_PEPPER_B64},{now:()=>at}),/MMF_PRIVATE_COMMERCIAL_STAGE_DENIED/);
 assert.throws(()=>new MmfCommercialStageKernel(a.ctx,{...f.env,MMF_STAGE_ONLY:'false'},{now:()=>at}),/MMF_PRIVATE_COMMERCIAL_STAGE_DENIED/);
 const app=new MmfCommercialStageKernel(a.ctx,f.env,{now:()=>at});
 const challenge=app.issueLoginChallenge();const session=app.acceptOidcLogin({nonce:challenge.nonce,idToken:f.token(challenge.nonce)});
 const tenantId='org-alpha';app.createTenant({sessionToken:session.sessionToken,tenantId});
 assert.deepEqual(app.effectiveEntitlement({sessionToken:session.sessionToken,tenantId}),{
  tenantId,canSend:false,canPubliclyCharge:false,reason:'PRODUCTION_RELEASE_NOT_QUALIFIED'
 });
 const quote=app.openSubscription({sessionToken:session.sessionToken,tenantId,planCode:'LAUNCH',orderReference:'MMF-ORDER-ABCDEF12345'});
 assert.equal(quote.canInitiatePaynow,false);
 assert.equal(quote.liveEntitlement,false);
});

test('Cloudflare SqlStorage change count uses actual changed rows and rejects SQL transaction tokens',t=>{
 const f=fixture(t),a=f.storage();t.after(()=>a.db.close());
 const db=createMmfCommercialSqliteDb(a.ctx.storage);
 db.exec('CREATE TABLE example (id INTEGER PRIMARY KEY, name TEXT)');
 assert.equal(db.prepare('INSERT INTO example(id,name) VALUES(?,?)').run(1,'ok').changes,1);
 assert.equal(db.prepare('UPDATE example SET name=? WHERE id=?').run('nope',999).changes,0);
 assert.equal(db.prepare('SELECT name FROM example WHERE id=?').get(1).name,'ok');
 assert.throws(()=>db.exec('BEGIN IMMEDIATE'),/MMF_PRIVATE_COMMERCIAL_STAGE_DENIED/);
 assert.throws(()=>db.prepare('SELECT * FROM example; DROP TABLE example'),/MMF_PRIVATE_COMMERCIAL_STAGE_DENIED/);
});

test('unconfigured Cloudflare wrapper is HTTP-deny-only with no default public DO forwarding',async()=>{
 const {readFileSync}=await import('node:fs');
 const {fileURLToPath}=await import('node:url');
 const wrapper=readFileSync(fileURLToPath(new URL('../src/edge/mmf-commercial-private-cloudflare.mjs',import.meta.url)),'utf8');
 const cfg=readFileSync(fileURLToPath(new URL('../wrangler.mmf.commercial-private.template.jsonc',import.meta.url)),'utf8');
 assert.match(wrapper,/extends DurableObject/);
 assert.match(wrapper,/export default \{async fetch\(\)\{return deny\(\)\}\}/);
 assert.match(cfg,/"workers_dev": false/);
 assert.match(cfg,/"preview_urls": false/);
 assert.match(cfg,/"routes": \[\]/);
 assert.match(cfg,/"MMF_COMMERCE_ENABLED":"false"/);
 assert.match(cfg,/"MMF_STAGE_ONLY":"false"/);
 assert.doesNotMatch(cfg,/"MMF_COMMERCE_ENABLED":"true"/);
});