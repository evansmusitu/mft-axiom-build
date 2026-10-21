import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageAndCommitSignedArtifactV2} from './signed-artifact-stage-v2.mjs';
import {verifyAndCommitSignedRegistryV2} from './signed-registry-v2-watermark.mjs';

const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const pem=keys.publicKey.export({type:'spki',format:'pem'});
const pin=createHash('sha256').update(pem).digest('hex');
const bytes=Buffer.from('a real local artifact; private one-pass signed delivery fixture\n');
const digest=createHash('sha256').update(bytes).digest('hex');
function manifest(rev=1,expectedDigest=digest){return {schema:'musitu.store.catalog.v2',revision:rev,
  issuedAt:'2026-10-17T00:00:00.000Z',expiresAt:'2026-10-24T00:00:00.000Z',
  publishers:[{id:'qualified-pilot',name:'Disposable publisher',grants:[{platform:'android',packageId:'org.example.pilot',signingCertificateSha256:'b'.repeat(64)}]}],
  apps:[{id:'pilot-app',publisherId:'qualified-pilot',releases:[{platform:'android',packageId:'org.example.pilot',
    version:'1.0.0',versionCode:rev,artifactURL:'https://artifacts.example.org/pilot.apk',
    sha256:expectedDigest,bytes:bytes.length,signingCertificateSha256:'b'.repeat(64)}]}]};}
function signed(c){let catalogBytes=Buffer.from(JSON.stringify(c));return {catalogBytes,
  signatureBytes:sign('sha256',catalogBytes,keys.privateKey),rootPublicKeyPem:pem,expectedRootPemSha256:pin,
  allowedArtifactHosts:['artifacts.example.org'],now:'2026-10-18T12:00:00.000Z'};}
function folder(t){const base=mkdtempSync(join(tmpdir(),'store-v2-one-pass-'));const store=join(base,'watermark'),cache=join(base,'cache');
  mkdirSync(store,{mode:0o700});mkdirSync(cache,{mode:0o700});const source=join(base,'artifact.apk');writeFileSync(source,bytes,{mode:0o600});
  t.after(()=>rmSync(base,{recursive:true,force:true}));return {store,cache,source};}
function deliver(d,options={}){return stageAndCommitSignedArtifactV2({storeDirectory:d.store,cacheDirectory:d.cache,
  sourceFile:d.source,appId:'pilot-app',platform:'android',bootstrapAuthorized:false,
  verificationOptions:signed(manifest()),...options});}
const watermark=d=>join(d.store,'accepted-v2-catalog.json');
const cached=d=>join(d.cache,digest+'.artifact');
test('authorized bootstrap stages exact signed binary then commits revision',t=>{
  const d=folder(t),r=deliver(d,{bootstrapAuthorized:true});
  assert.equal(r.status,'STAGED_PRIVATE_REVIEW_ONLY');
  assert.equal(JSON.parse(readFileSync(watermark(d),'utf8')).revision,1);
  assert.deepEqual(readFileSync(r.privatePath),bytes);
  assert.equal(existsSync(join(d.store,'accepted-v2-catalog.lock')),false);
});
test('first-run without approval cannot stage or commit',t=>{
  const d=folder(t);assert.throws(()=>deliver(d),/bootstrap|watermark/i);
  assert.equal(existsSync(watermark(d)),false);assert.equal(existsSync(cached(d)),false);
});
test('tampered bytes fail without promoting a revision',t=>{
  const d=folder(t);writeFileSync(d.source,Buffer.from('X'.repeat(bytes.length)),{mode:0o600});
  assert.throws(()=>deliver(d,{bootstrapAuthorized:true}),/sha-256|hash|match/i);
  assert.equal(existsSync(watermark(d)),false);assert.equal(existsSync(cached(d)),false);
});
test('higher signed catalog revision is committed after staging; old revision is rejected',t=>{
  const d=folder(t);deliver(d,{bootstrapAuthorized:true});deliver(d,{verificationOptions:signed(manifest(3))});
  assert.equal(JSON.parse(readFileSync(watermark(d),'utf8')).revision,3);
  assert.throws(()=>deliver(d),/replay|revision/i);
});
test('bad signed expected artifact hash never promotes revision',t=>{
  const d=folder(t);deliver(d,{bootstrapAuthorized:true});
  assert.throws(()=>deliver(d,{verificationOptions:signed(manifest(2,'f'.repeat(64)))}),/sha-256|hash|match/i);
  assert.equal(JSON.parse(readFileSync(watermark(d),'utf8')).revision,1);
});
test('caller-supplied untrusted revision override is rejected',t=>{
  const d=folder(t);deliver(d,{bootstrapAuthorized:true});
  assert.throws(()=>deliver(d,{verificationOptions:{...signed(manifest(2)),highestAcceptedRevision:0}}),/override|watermark/i);
  assert.equal(JSON.parse(readFileSync(watermark(d),'utf8')).revision,1);
});
test('abandoned transaction lock blocks file staging and first bootstrap',t=>{
  const d=folder(t),lock=join(d.store,'accepted-v2-catalog.lock');writeFileSync(lock,'unreviewed',{mode:0o600});
  assert.throws(()=>deliver(d,{bootstrapAuthorized:true}),/lock|concurrent|recovery/i);
  assert.equal(readFileSync(lock,'utf8'),'unreviewed');assert.equal(existsSync(cached(d)),false);
});
test('poisoned cache is not overwritten and cannot advance watermark',t=>{
  const d=folder(t);writeFileSync(cached(d),'poison',{mode:0o600});
  assert.throws(()=>deliver(d,{bootstrapAuthorized:true}),/existing|cache|checksum|mismatch/i);
  assert.equal(existsSync(watermark(d)),false);assert.equal(readFileSync(cached(d),'utf8'),'poison');
});
test('asynchronous pre-commit callback is rejected before revision commit',t=>{
  const d=folder(t);assert.throws(()=>verifyAndCommitSignedRegistryV2({storeDirectory:d.store,verificationOptions:signed(manifest()),
    bootstrapAuthorized:true,beforeCommit:()=>Promise.resolve(true)}),/synchronous|async|callback/i);
  assert.equal(existsSync(watermark(d)),false);
});
test('catalog signature cannot delegate artifact host outside root-approved list',t=>{
  const d=folder(t),c=manifest();c.apps[0].releases[0].artifactURL='https://unapproved.invalid/a.apk';
  assert.throws(()=>deliver(d,{verificationOptions:signed(c),bootstrapAuthorized:true}),/host|artifact/i);
  assert.equal(existsSync(watermark(d)),false);assert.equal(existsSync(cached(d)),false);
});
