import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,symlinkSync,statSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageSignedLocalArtifactV2} from './signed-artifact-stage-v2.mjs';

const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const pem=key.publicKey.export({type:'spki',format:'pem'});
const rootPin=createHash('sha256').update(pem).digest('hex');
const fixture=Buffer.from('independently signed artifact bytes in offline test\n');
const artifactDigest=createHash('sha256').update(fixture).digest('hex');
const certDigest='b'.repeat(64);
function catalog({byteDigest=artifactDigest,artifactBytes=fixture.length,revision=1,duplicate=false}={}){
  const release={platform:'android',packageId:'org.example.fixture',version:'1.0.0',versionCode:1,
    artifactURL:'https://artifacts.example.org/fixture.apk',sha256:byteDigest,bytes:artifactBytes,
    signingCertificateSha256:certDigest};
  return {schema:'musitu.store.catalog.v2',revision,issuedAt:'2026-10-17T00:00:00.000Z',
    expiresAt:'2026-10-24T00:00:00.000Z',publishers:[{id:'example-publisher',name:'Example Publisher',
      grants:[{platform:'android',packageId:'org.example.fixture',signingCertificateSha256:certDigest}]}],
    apps:[{id:'example-app',publisherId:'example-publisher',releases:duplicate?[release,{...release,versionCode:2}]:[release]}]};
}
function signed(data){
  const catalogBytes=Buffer.from(JSON.stringify(data));
  return {catalogBytes,signatureBytes:sign('sha256',catalogBytes,key.privateKey),rootPublicKeyPem:pem,
    expectedRootPemSha256:rootPin,highestAcceptedRevision:0,highestAcceptedDigest:null,
    allowedArtifactHosts:['artifacts.example.org'],now:'2026-10-18T08:00:00.000Z'};
}
function scenario(t){
  const base=mkdtempSync(join(tmpdir(),'musitu-v2-offline-stage-'));
  const cache=join(base,'cache');mkdirSync(cache,{mode:0o700});
  const source=join(base,'fixture.apk');writeFileSync(source,fixture,{mode:0o600});
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  return {base,cache,source};
}
function stage(d,opts={}){return stageSignedLocalArtifactV2({
  verificationOptions:signed(opts.catalog??catalog()),appId:'example-app',platform:'android',
  cacheDirectory:d.cache,sourceFile:d.source,...opts
});}

test('stage real bytes after independently verifying the root-signed release and SHA-256',t=>{
  const s=scenario(t);
  const result=stage(s);
  assert.equal(result.catalogRevision,1);
  assert.equal(result.sha256,artifactDigest);
  assert.equal(result.packageId,'org.example.fixture');
  assert.equal(result.platform,'android');
  assert.equal(result.reused,false);
  assert.deepEqual(readFileSync(result.privatePath),fixture);
  assert.equal(statSync(result.privatePath).mode&0o777,0o600);
  assert.match(result.privatePath,new RegExp(artifactDigest+'\\.artifact$'));
  assert.equal(existsSync(join(s.cache,'unverified.apk')),false);
});
test('valid staged bytes are reused without overwriting a previously verified artifact',t=>{
  const s=scenario(t);const first=stage(s);const second=stage(s);
  assert.equal(second.reused,true);assert.equal(second.privatePath,first.privatePath);
  assert.deepEqual(readFileSync(first.privatePath),fixture);
});
test('a signed catalog may not stage bytes that fail the signed SHA-256 or size',t=>{
  const s=scenario(t);
  assert.throws(()=>stage(s,{catalog:catalog({byteDigest:'f'.repeat(64)})}),/digest|sha|hash|mismatch/i);
  assert.throws(()=>stage(s,{catalog:catalog({artifactBytes:fixture.length+1})}),/size|bytes|length/i);
  assert.deepEqual(readFileSync(s.source),fixture);
});
test('signed provenance fails closed on unauthorized alternate root or changed signature',t=>{
  const s=scenario(t);
  const verificationOptions=signed(catalog());verificationOptions.signatureBytes=Buffer.from(verificationOptions.signatureBytes);
  verificationOptions.signatureBytes[0]^=0x01;
  assert.throws(()=>stage(s,{verificationOptions}),/signature/i);
  assert.equal(existsSync(join(s.cache,artifactDigest+'.artifact')),false);
});
test('symlink source and symlink destination must not be followed',t=>{
  const s=scenario(t);const link=join(s.base,'alias.apk');symlinkSync(s.source,link);
  assert.throws(()=>stage(s,{sourceFile:link}),/symbolic|symlink|source|regular|safe/i);
  const target=join(s.base,'untouched');writeFileSync(target,'untouched',{mode:0o600});
  symlinkSync(target,join(s.cache,artifactDigest+'.artifact'));
  assert.throws(()=>stage(s),/symlink|destination|artifact|safe|regular/i);
  assert.equal(readFileSync(target,'utf8'),'untouched');
});
test('existing incorrect digest cache cannot be reused or overwritten',t=>{
  const s=scenario(t);const p=join(s.cache,artifactDigest+'.artifact');writeFileSync(p,'rogue',{mode:0o600});
  assert.throws(()=>stage(s),/cache|digest|sha|mismatch|existing/i);
  assert.equal(readFileSync(p,'utf8'),'rogue');
});
test('insecure cache directory permissions and symlink directory abort staging',t=>{
  const s=scenario(t);chmodSync(s.cache,0o755);
  assert.throws(()=>stage(s),/private|directory|permission|owner/i);
  chmodSync(s.cache,0o700);const alias=join(s.base,'cachealias');symlinkSync(s.cache,alias);
  assert.throws(()=>stage(s,{cacheDirectory:alias}),/directory|symlink|private/i);
});
test('multiple same-platform signed releases require explicit channel selection',t=>{
  const s=scenario(t);
  assert.throws(()=>stage(s,{catalog:catalog({duplicate:true})}),/ambiguous|channel|multiple/i);
});
test('expired root-signed catalog cannot stage an otherwise valid binary',t=>{
  const s=scenario(t),opts=signed(catalog());opts.now='2026-11-01T00:00:00.000Z';
  assert.throws(()=>stage(s,{verificationOptions:opts}),/expired/i);
});
test('staging bytes never installs an app or mutates the signed source',t=>{
  const s=scenario(t);const result=stage(s);
  assert.deepEqual(readFileSync(s.source),fixture);
  assert.equal(result.status,'STAGED_PRIVATE_REVIEW_ONLY');
  assert.equal('installerResult' in result,false);
});
