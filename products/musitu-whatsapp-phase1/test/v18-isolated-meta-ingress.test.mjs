import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import ingress from '../deployments/meta-ingress/api/index.mjs';

test('isolated ingress has no business UI, source, login, status or send surface',async()=>{
 for(const path of ['/','/api/status','/auth/login','/api/businesses','/api/send','/package.json','/runtime/source-digests.json','/api/index']){
  const reply=await ingress.fetch(new Request('https://isolated.invalid'+path));
  assert.equal(reply.status,404,path);assert.equal(await reply.text(),'NOT_FOUND');
  assert.equal(reply.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  assert.match(reply.headers.get('content-security-policy'),/default-src 'none'/);
 }
});

test('unconfigured isolated ingress fails closed and never reports successful verification',async()=>{
 const url='https://isolated.invalid/api/meta/webhook';
 const before=process.env.META_APP_SECRET;delete process.env.META_APP_SECRET;
 try{
  const verify=await ingress.fetch(new Request(url+'?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123'));
  assert.equal(verify.status,503);
  const event=await ingress.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));
  assert.equal(event.status,401);
  const other=await ingress.fetch(new Request(url,{method:'DELETE'}));assert.equal(other.status,405);
 }finally{if(before!==undefined)process.env.META_APP_SECRET=before;}
});

test('standalone receiver is byte-identical to its reviewed shared callback import closure',()=>{
 const output=execFileSync(process.execPath,['scripts/prepare-meta-ingress.mjs','--check'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.match(output,/INGRESS_BUNDLE_CURRENT/);
});
