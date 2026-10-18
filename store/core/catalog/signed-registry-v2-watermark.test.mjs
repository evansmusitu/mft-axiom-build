import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,statSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {verifyAndCommitSignedRegistryV2} from './signed-registry-v2-watermark.mjs';

const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const pem=publicKey.export({type:'spki',format:'pem'});
const pin=createHash('sha256').update(Buffer.from(pem)).digest('hex');
const now='2026-10-17T12:00:00.000Z';
function catalog(revision=1){
  return {schema:'musitu.store.catalog.v2',revision,
    issuedAt:'2026-10-17T00:00:00.000Z',expiresAt:'2026-10-24T00:00:00.000Z',
    publishers:[{id:'pilot-publisher',name:'Local pilot publisher',grants:[{platform:'android',packageId:'org.pilot.app',signingCertificateSha256:'b'.repeat(64)}]}],
    apps:[{id:'pilot-app',publisherId:'pilot-publisher',releases:[{platform:'android',packageId:'org.pilot.app',version:'1.0.0',versionCode:revision,artifactURL:'https://artifacts.example.org/pilot.apk',sha256:'a'.repeat(64),bytes:4096,signingCertificateSha256:'b'.repeat(64)}]}]};
}
function signed(data){
  const catalogBytes=Buffer.from(JSON.stringify(data));
  return {catalogBytes,signatureBytes:sign('sha256',catalogBytes,privateKey),rootPublicKeyPem:pem,
    expectedRootPemSha256:pin,allowedArtifactHosts:['artifacts.example.org'],now};
}
function directory(t){
  const base=mkdtempSync(join(tmpdir(),'store-v2-watermark-'));
  const where=join(base,'state');mkdirSync(where,{mode:0o700});
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  return where;
}
const file=(where)=>join(where,'accepted-v2-catalog.json');
const lock=(where)=>join(where,'accepted-v2-catalog.lock');
const pending=(where)=>join(where,'accepted-v2-catalog.pending');
const invoke=(where,revision=1,options={})=>verifyAndCommitSignedRegistryV2({
  storeDirectory:where,verificationOptions:signed(catalog(revision)),...options
});

test('explicit first-install bootstrap durably pins catalog revision and fingerprint',t=>{
  const where=directory(t);
  const result=invoke(where,1,{bootstrapAuthorized:true});
  const saved=JSON.parse(readFileSync(file(where),'utf8'));
  assert.equal(result.registry.revision,1);
  assert.equal(saved.revision,1);
  assert.equal(saved.rootPemSha256,pin);
  assert.equal(saved.catalogSha256,result.catalogSha256);
  assert.equal(statSync(file(where)).mode&0o777,0o600);
  assert.equal(existsSync(lock(where)),false);
  assert.equal(existsSync(pending(where)),false);
});
test('missing trusted watermark fails closed unless first install was explicitly authorized',t=>{
  const where=directory(t);
  assert.throws(()=>invoke(where),/bootstrap|watermark/i);
  assert.equal(existsSync(file(where)),false);
});
test('monotonic revisions advance, rollback and equivocation fail without changing committed state',t=>{
  const where=directory(t);
  invoke(where,1,{bootstrapAuthorized:true});
  const same=invoke(where,1);assert.equal(same.registry.revision,1);
  invoke(where,3);
  const latest=readFileSync(file(where),'utf8');
  assert.throws(()=>invoke(where,2),/replay|revision/i);
  const options=signed(catalog(3));
  const other=JSON.parse(options.catalogBytes.toString());other.apps[0].releases[0].version='3.0.1';
  assert.throws(()=>verifyAndCommitSignedRegistryV2({storeDirectory:where,verificationOptions:signed(other)}),/equivocation|digest/i);
  assert.equal(readFileSync(file(where),'utf8'),latest);
});
test('already-existing crash lock fails closed without removing the lock or trusting input',t=>{
  const where=directory(t);
  writeFileSync(lock(where),'operator-recovery-needed',{flag:'wx',mode:0o600});
  assert.throws(()=>invoke(where,1,{bootstrapAuthorized:true}),/lock|busy|concurrent/i);
  assert.equal(readFileSync(lock(where),'utf8'),'operator-recovery-needed');
  assert.equal(existsSync(file(where)),false);
});
test('truncated or invalid watermark cannot be reset using first-run authorization',t=>{
  const where=directory(t);
  writeFileSync(file(where),'{',{mode:0o600});
  assert.throws(()=>invoke(where,1,{bootstrapAuthorized:true}),/invalid|corrupt|watermark/i);
  assert.equal(readFileSync(file(where),'utf8'),'{');
});
test('trusted root fingerprint changes are rejected before accepted state can change',t=>{
  const where=directory(t);invoke(where,1,{bootstrapAuthorized:true});
  const k=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const newPem=k.publicKey.export({type:'spki',format:'pem'});
  const s=signed(catalog(2));s.rootPublicKeyPem=newPem;
  s.expectedRootPemSha256=createHash('sha256').update(newPem).digest('hex');
  s.signatureBytes=sign('sha256',s.catalogBytes,k.privateKey);
  assert.throws(()=>verifyAndCommitSignedRegistryV2({storeDirectory:where,verificationOptions:s}),/root|anchor|pin/i);
  assert.equal(JSON.parse(readFileSync(file(where),'utf8')).revision,1);
});
test('unsigned catalog mutation rejects without watermark promotion',t=>{
  const where=directory(t);invoke(where,1,{bootstrapAuthorized:true});
  const s=signed(catalog(2));s.catalogBytes=Buffer.from(s.catalogBytes);s.catalogBytes[1]=60;
  assert.throws(()=>verifyAndCommitSignedRegistryV2({storeDirectory:where,verificationOptions:s}),/signature/i);
  assert.equal(JSON.parse(readFileSync(file(where),'utf8')).revision,1);
});
test('private state directory is mandatory; stale pending write blocks a new transaction',t=>{
  const where=directory(t);
  chmodSync(where,0o755);
  assert.throws(()=>invoke(where,1,{bootstrapAuthorized:true}),/private|mode|permissions/i);
  chmodSync(where,0o700);
  writeFileSync(pending(where),'incomplete',{mode:0o600});
  assert.throws(()=>invoke(where,1,{bootstrapAuthorized:true}),/pending|recovery|exists/i);
  assert.equal(existsSync(file(where)),false);
});
test('symlinked watermark is rejected without replacing or trusting target',t=>{
  const where=directory(t);
  const victim=join(where,'innocent');writeFileSync(victim,'immutable',{mode:0o600});
  symlinkSync(victim,file(where));
  assert.throws(()=>invoke(where,1,{bootstrapAuthorized:true}),/symlink|watermark|regular|unsafe/i);
  assert.equal(readFileSync(victim,'utf8'),'immutable');
});
test('noncanonical or duplicate-key persisted watermark is rejected without silent rewrite',t=>{
  const where=directory(t);invoke(where,1,{bootstrapAuthorized:true});
  const old=readFileSync(file(where),'utf8');
  writeFileSync(file(where),old.replace('"revision":1,','"revision":1,"revision":0,'));
  assert.throws(()=>invoke(where,2,{bootstrapAuthorized:true}),/noncanonical|watermark/i);
  assert.equal(readFileSync(file(where),'utf8').includes('"revision":0'),true);
});
test('caller supplied rollback watermark and symlinked state directories are rejected',t=>{
  const where=directory(t);
  const s=signed(catalog(1));
  assert.throws(()=>verifyAndCommitSignedRegistryV2({storeDirectory:where,
    verificationOptions:{...s,highestAcceptedRevision:0},bootstrapAuthorized:true}),/override|watermark/i);
  const shortcut=join(where,'..','aliased-state');
  symlinkSync(where,shortcut);
  assert.throws(()=>verifyAndCommitSignedRegistryV2({storeDirectory:shortcut,
    verificationOptions:s,bootstrapAuthorized:true}),/private|directory/i);
});
