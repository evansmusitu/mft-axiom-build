import test from 'node:test';
import assert from 'node:assert/strict';
import {issueStaffCookie,verifyStaffCookie} from '../src/session.mjs';
const SECRET='S'.repeat(48),jwt='eyJ'+('a'.repeat(170));
const env={STUDIO_ADMIN_TOKEN:SECRET,STUDIO_SESSION_ENABLED:'true'};
function request({token=jwt,cookie='',origin='https://studio.mftintelligence.com'}={}){
  return new Request(origin+'/api/projects',{headers:{
    'cf-access-jwt-assertion':token,...(cookie?{Cookie:cookie}:{})}});
}
test('no access session in local bypass, absent config, or weak secret',async()=>{
  assert.equal(await issueStaffCookie(request(),{...env,STUDIO_LOCAL_TEST_ONLY:'true'}),null);
  assert.equal(await issueStaffCookie(request(),{...env,STUDIO_SESSION_ENABLED:'false'}),null);
  assert.equal(await issueStaffCookie(request(),{...env,STUDIO_ADMIN_TOKEN:'short'}),null);
  assert.equal(await verifyStaffCookie(request(),env),false);
});
test('staff cookie is signed, strictly short lived, HttpOnly and bound to exact Access JWT',async()=>{
  const cookie=await issueStaffCookie(request(),env);
  assert.ok(cookie?.startsWith('musitu_staff_session='));
  assert.ok(cookie.includes('HttpOnly')&&cookie.includes('Secure')&&cookie.includes('SameSite=Strict'));
  assert.ok(cookie.includes('Path=/api')&&cookie.includes('Max-Age=3600'));
  const raw=cookie.split(';')[0];
  assert.equal(await verifyStaffCookie(request({cookie:raw}),env),true);
  assert.equal(await verifyStaffCookie(request({cookie:raw,token:jwt+'X'}),env),false);
  assert.equal(await verifyStaffCookie(request({cookie:raw}),{...env,STUDIO_ADMIN_TOKEN:'T'.repeat(48)}),false);
  const tampered=raw.slice(0,-1)+(raw.at(-1)==='a'?'b':'a');
  assert.equal(await verifyStaffCookie(request({cookie:tampered}),env),false);
  assert.equal(await verifyStaffCookie(request({cookie:'musitu_staff_session=invalid'}),env),false);
  assert.equal(await verifyStaffCookie(request({cookie:raw}),{...env,STUDIO_LOCAL_TEST_ONLY:'true'}),false);
});
test('reject expired signed staff sessions even if signature valid',async()=>{
  const issued=(await issueStaffCookie(request(),env)).split(';')[0].split('=')[1];
  const original=JSON.parse(Buffer.from(issued.split('.')[0],'base64url').toString('utf8'));
  original.iat=Math.floor(Date.now()/1000)-4000;
  const encoded=Buffer.from(JSON.stringify(original)).toString('base64url');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(encoded))).toString('hex');
  assert.equal(await verifyStaffCookie(request({cookie:'musitu_staff_session='+encoded+'.'+signature}),env),false);
});
