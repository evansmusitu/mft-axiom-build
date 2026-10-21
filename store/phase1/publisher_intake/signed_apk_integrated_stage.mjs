/**
 * Offline CI-only end-to-end private publisher fixture qualification.
 * Android SDK independently checks the disposable signed APK; ephemeral
 * P-256 test root authorizes its digest, signer and package. The production
 * V2 root, publisher identities and release services are NOT used.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {chmodSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {stageAndCommitSignedArtifactV2} from '../../core/catalog/signed-artifact-stage-v2.mjs';

const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
function cmd(tool,args){return execFileSync(tool,args,{encoding:'utf8',timeout:30000,maxBuffer:1000000});}
function sdk(name){
  const home=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT;
  if(!home)throw new Error('isolated Android SDK required');
  return join(home,'build-tools','36.0.0',name);
}
function metadata(path){
  const badges=cmd(sdk('aapt'),['dump','badging',path]);
  const packageMatch=badges.match(/^package: name='([^']+)' versionCode='([0-9]+)'/m);
  assert.ok(packageMatch,'Android SDK verified package identity required');
  const signerOutput=cmd(sdk('apksigner'),['verify','--print-certs',path]);
  const signerLines=signerOutput.split(/\r?\n/).filter(s=>s.includes('certificate SHA-256 digest:'));
  assert.equal(signerLines.length,1,'exactly one independently verified APK signer required');
  const cert=signerLines[0].split('certificate SHA-256 digest:')[1].trim().toLowerCase();
  assert.match(cert,/^[0-9a-f]{64}$/);
  return {packageId:packageMatch[1],versionCode:Number(packageMatch[2]),certificate:cert};
}
function run(path){
  assert.ok(process.env.CI,'CI-only disposable signed APK qualification');
  path=resolve(path);
  const apk=metadata(path),bytes=readFileSync(path);
  assert.equal(apk.packageId,'org.musitu.fixturealpha','only disposable fixture alpha allowed');
  assert.ok(Number.isSafeInteger(apk.versionCode)&&apk.versionCode>0);
  assert.ok(bytes.length>0&&bytes.length<=512*1024*1024);
  // Operating system private file custody; this is not a public output artifact.
  chmodSync(path,0o600);
  const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const pem=key.publicKey.export({type:'spki',format:'pem'});
  const pin=sha(Buffer.from(pem));
  const base=mkdtempSync(join(tmpdir(),'musitu-v2-disposable-signed-apk-'));
  try{
    const storeDirectory=join(base,'watermark');
    const cacheDirectory=join(base,'staging');
    mkdirSync(storeDirectory,{mode:0o700});
    mkdirSync(cacheDirectory,{mode:0o700});
    const baseCatalog=(revision=1,expectedSha=sha(bytes))=>({
      schema:'musitu.store.catalog.v2',revision,
      issuedAt:'2026-10-17T00:00:00.000Z',
      expiresAt:'2026-10-24T00:00:00.000Z',
      publishers:[{id:'temporary-fixture',name:'Temporary CI publisher',
        grants:[{platform:'android',packageId:apk.packageId,signingCertificateSha256:apk.certificate}]}],
      apps:[{id:'fixture-alpha',publisherId:'temporary-fixture',releases:[{
        platform:'android',packageId:apk.packageId,version:'1.0.0',
        versionCode:apk.versionCode,artifactURL:'https://artifacts.example.org/ci-only.apk',
        sha256:expectedSha,bytes:bytes.length,signingCertificateSha256:apk.certificate
      }]}]
    });
    const options=(data)=>{
      const catalogBytes=Buffer.from(JSON.stringify(data));
      return {catalogBytes,signatureBytes:sign('sha256',catalogBytes,key.privateKey),
        rootPublicKeyPem:pem,expectedRootPemSha256:pin,
        allowedArtifactHosts:['artifacts.example.org'],now:'2026-10-18T08:00:00.000Z'};
    };
    const prepare=(revision,expectedSha,bootstrapAuthorized=false)=>stageAndCommitSignedArtifactV2({
      storeDirectory,cacheDirectory,appId:'fixture-alpha',platform:'android',
      sourceFile:path,bootstrapAuthorized,verificationOptions:options(baseCatalog(revision,expectedSha))
    });
    const first=prepare(1,sha(bytes),true);
    assert.equal(first.status,'STAGED_PRIVATE_REVIEW_ONLY');
    assert.deepEqual(readFileSync(first.privatePath),bytes);
    assert.equal(statSync(first.privatePath).mode&0o777,0o600);
    const same=prepare(1,sha(bytes));
    assert.equal(same.reused,true);
    assert.throws(()=>prepare(2,'f'.repeat(64)),/SHA-256|digest|match/i);
    const state=JSON.parse(readFileSync(join(storeDirectory,'accepted-v2-catalog.json'),'utf8'));
    assert.equal(state.revision,1,'never promote wrong APK digest');
    assert.throws(()=>prepare(0,sha(bytes)),/revision|positive/i);
    console.log('MUSITU_STORE_V2_SIGNED_REAL_APK_OFFLINE_COMMIT_PASS installed=false production=false stages=2 negatives=2');
  }finally{
    rmSync(base,{recursive:true,force:true});
  }
}
if(process.argv.length!==3)throw new Error('usage: node signed_apk_integrated_stage.mjs disposable-signed.apk');
run(process.argv[2]);
