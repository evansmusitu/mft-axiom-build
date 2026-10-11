import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {verifySignedRegistryV2} from './signed-registry-v2.mjs';

const {privateKey, publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const rootPublicKeyPem=publicKey.export({type:'spki',format:'pem'});
const expectedRootPemSha256=createHash('sha256').update(Buffer.from(rootPublicKeyPem)).digest('hex');
const DIGEST='a'.repeat(64),CERT='b'.repeat(64),WIN_CERT='c'.repeat(64);
const NOW='2026-10-12T12:00:00.000Z';
const fresh=()=>({
  schema:'musitu.store.catalog.v2',
  revision:1,
  issuedAt:'2026-10-11T00:00:00.000Z',
  expiresAt:'2026-10-18T00:00:00.000Z',
  publishers:[
    {id:'musitu',name:'MUSITU',grants:[
      {platform:'android',packageId:'com.musitu.chemistry',signingCertificateSha256:CERT},
      {platform:'web',packageId:'https://payments.mftintelligence.com/chemistry/app/'}
    ]},
    {id:'northstar',name:'Northstar Apps',grants:[
      {platform:'windows',packageId:'Northstar.Desktop',signingCertificateSha256:WIN_CERT}
    ]}
  ],
  apps:[
    {id:'musitu-chemistry',publisherId:'musitu',releases:[
      {platform:'android',packageId:'com.musitu.chemistry',version:'1.3.0',versionCode:10200,artifactURL:'https://payments.mftintelligence.com/chemistry/download/app.apk',sha256:DIGEST,bytes:5892286,signingCertificateSha256:CERT},
      {platform:'web',packageId:'https://payments.mftintelligence.com/chemistry/app/',version:'1.3.0',versionCode:10200,artifactURL:'https://payments.mftintelligence.com/chemistry/carrier.tar.gz',sha256:DIGEST,bytes:2000}
    ]},
    {id:'northstar-desktop',publisherId:'northstar',releases:[
      {platform:'windows',packageId:'Northstar.Desktop',version:'1.0.0',versionCode:100,artifactURL:'https://payments.mftintelligence.com/store/windows/northstar.msix',sha256:DIGEST,bytes:5000,signingCertificateSha256:WIN_CERT}
    ]}
  ]
});
const opts=(data=fresh(),overrides={})=>{
  const catalogBytes=Buffer.from(JSON.stringify(data));
  const signatureBytes=sign('sha256',catalogBytes,privateKey);
  return {catalogBytes,signatureBytes,rootPublicKeyPem,expectedRootPemSha256,
    highestAcceptedRevision:0,highestAcceptedDigest:null,allowedArtifactHosts:['payments.mftintelligence.com'],
    now:NOW,...overrides};
};
const verify=(data=fresh(),overrides={})=>verifySignedRegistryV2(opts(data,overrides));

test('valid signed catalog with two independent publishers and three platform carriers',()=>{
  const result=verify();
  assert.equal(result.registry.schema,'musitu.store.catalog.v2');
  assert.equal(result.registry.revision,1);
  assert.equal(result.registry.apps.length,2);
  assert.equal(result.verifiedRootPemSha256,expectedRootPemSha256);
  assert.match(result.catalogSha256,/^[a-f0-9]{64}$/);
});
test('rejects post-signature tampering',()=>{
  const argumentsObject=opts();
  const tampered=Buffer.from(argumentsObject.catalogBytes);
  const location=tampered.indexOf(Buffer.from('Northstar Apps'));
  assert.ok(location>=0);
  tampered[location]='X'.charCodeAt(0);
  assert.throws(()=>verifySignedRegistryV2({...argumentsObject,catalogBytes:tampered}),/signature/i);
});
test('rejects a different valid signing key rather than trusting uploaded keys',()=>{
  const rogue=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const a=opts();a.signatureBytes=sign('sha256',a.catalogBytes,rogue.privateKey);
  assert.throws(()=>verifySignedRegistryV2(a),/signature/i);
});
test('rejects root signer pin mismatch',()=>{
  assert.throws(()=>verify(fresh(),{expectedRootPemSha256:'f'.repeat(64)}),/root|pin/i);
});
test('rejects expired signed catalog',()=>{
  const data=fresh();data.expiresAt='2026-10-11T00:00:00.000Z';
  assert.throws(()=>verify(data),/expired|expir/i);
});
test('rejects signed metadata issued too far into the future',()=>{
  const data=fresh();data.issuedAt='2026-10-15T00:00:00.000Z';
  assert.throws(()=>verify(data),/future|issued/i);
});
test('rejects revisions below the trusted monotonic watermark',()=>{
  assert.throws(()=>verify(fresh(),{highestAcceptedRevision:2,highestAcceptedDigest:'a'.repeat(64)}),/replay|revision/i);
});
test('rejects same revision if the previous digest is missing or mismatched',()=>{
  assert.throws(()=>verify(fresh(),{highestAcceptedRevision:1,highestAcceptedDigest:null}),/digest|revision/i);
  assert.throws(()=>verify(fresh(),{highestAcceptedRevision:1,highestAcceptedDigest:'f'.repeat(64)}),/digest|equivocation/i);
});
test('accepts exactly the same signed bytes at the accepted revision',()=>{
  const a=opts();const digest=createHash('sha256').update(a.catalogBytes).digest('hex');
  const result=verifySignedRegistryV2({...a,highestAcceptedRevision:1,highestAcceptedDigest:digest});
  assert.equal(result.registry.revision,1);
});
test('rejects application without an authorized publisher',()=>{
  const data=fresh();data.apps[0].publisherId='unknown';
  assert.throws(()=>verify(data),/publisher/i);
});
test('rejects a duplicate app identity',()=>{
  const data=fresh();data.apps.push(structuredClone(data.apps[0]));
  assert.throws(()=>verify(data),/duplicate/i);
});
test('rejects duplicate package claims even across different publishers',()=>{
  const data=fresh();data.publishers[1].grants.push(structuredClone(data.publishers[0].grants[0]));
  assert.throws(()=>verify(data),/duplicate|ownership/i);
});
test('rejects signer changes not authorized by the root delegation',()=>{
  const data=fresh();data.apps[0].releases[0].signingCertificateSha256='d'.repeat(64);
  assert.throws(()=>verify(data),/signer|certificate|delegation/i);
});
test('rejects package takeover by another publisher',()=>{
  const data=fresh();data.apps[0].publisherId='northstar';
  assert.throws(()=>verify(data),/publisher|delegation|ownership/i);
});
test('rejects artifact delivery from a host outside trusted policy',()=>{
  const data=fresh();data.apps[0].releases[0].artifactURL='https://untrusted.example/evil.apk';
  assert.throws(()=>verify(data),/host|artifact/i);
});
test('rejects non-HTTPS and userinfo artifact URLs',()=>{
  const data=fresh();data.apps[0].releases[0].artifactURL='http://payments.mftintelligence.com/app.apk';
  assert.throws(()=>verify(data),/https|url/i);
  data.apps[0].releases[0].artifactURL='https://user:pass@payments.mftintelligence.com/app.apk';
  assert.throws(()=>verify(data),/userinfo|url/i);
});
test('rejects malformed digest and invalid package identifiers',()=>{
  const data=fresh();data.apps[0].releases[0].sha256='abc';
  assert.throws(()=>verify(data),/digest|sha256/i);
  data.apps[0].releases[0].sha256=DIGEST;
  data.apps[0].releases[0].packageId='not-a-package';
  assert.throws(()=>verify(data),/package/i);
});
test('rejects web release without a matching root delegation',()=>{
  const data=fresh();data.publishers[0].grants.pop();
  assert.throws(()=>verify(data),/delegation|ownership/i);
});
test('rejects zero or oversized artifact lengths',()=>{
  const data=fresh();data.apps[0].releases[0].bytes=0;
  assert.throws(()=>verify(data),/bytes|size/i);
});
test('rejects signed catalog longer than one MiB',()=>{
  const data=fresh();data.apps[0].extra='X'.repeat(1024*1024);
  assert.throws(()=>verify(data),/size|large/i);
});
test('verified registry is immutable to callers',()=>{
  const r=verify();
  assert.throws(()=>r.registry.apps[0].releases[0].packageId='com.evil.app',/read only/i);
});

test('existing Phase-1 MUSITU catalog PEM trust anchor retains its exact historical fingerprint',async()=>{
  const {readFileSync}=await import('node:fs');
  const pem=readFileSync('store/phase1/catalog-signing-public.pem','utf8');
  const sha=createHash('sha256').update(Buffer.from(pem,'utf8')).digest('hex');
  assert.equal(sha,'4cf17f70dbab900237d8b82b4e989978c667e6ec841de6df79469aa6c5ebd5c0');
});
test('rejects an unsupported platform even under valid root signature',()=>{
  const data=fresh();data.apps[0].releases[0].platform='ios';
  assert.throws(()=>verify(data),/unsupported platform/i);
});
test('rejects trust watermark omissions rather than assuming first installation',()=>{
  const a=opts();
  assert.throws(()=>verifySignedRegistryV2({...a,highestAcceptedRevision:undefined}),/watermark/i);
});
test('rejects signed manifests valid for more than thirty days',()=>{
  const data=fresh();data.expiresAt='2026-11-20T00:00:00.000Z';
  assert.throws(()=>verify(data),/validity|window/i);
});
