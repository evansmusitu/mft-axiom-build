// OFFLINE ONLY. These tests cannot qualify a real identity or account owner.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleOAuthHandoffPrivate,handleOAuthHandoffBrowser} from '../../auth/oauth_session_handoff_candidate.mjs';
test('the new OAuth handoff remains closed without independent admission',async()=>{
 const req=new Request('https://axiom-internal/oauth/handoff/create',{method:'POST'});
 assert.equal((await handleOAuthHandoffPrivate(req,{})).status,503);
 const browser=new Request('https://axiom-customer-staging.mftintelligence.com/auth/oauth/authorize?handoff='+'A'.repeat(43));
 assert.equal((await handleOAuthHandoffBrowser(browser,{})).status,503);
});
import {setupHandoff,cookie,input,sha,principal,customer,auth,portal,path,resource,ownershipSQL} from './oauth_handoff_fixture.mjs';
import {handleIdentityBinding} from '../customer_control_plane/zitadel_session_broker_candidate.mjs';
import {withCanonicalMCPAdmission} from '../../mcp/canonical_mcp_admission_candidate.mjs';
import published from './fixtures/gate4-published-gateway/gateway.mjs';

test('signed IdP login -> explicit consent -> one-use OAuth proof -> same website/customer/MCP identity',async t=>{
 const f=setupHandoff(t),a=await f.approved();
 assert.equal(f.exchanges,1);assert.doesNotMatch(a.h.html,/musitu_account_key|required/);
 assert.match(a.h.oauthCookie,/^__Host-axiom_oauth_flow=/);assert.ok(a.session.startsWith('__Host-axiom_customer='));
 assert(!a.html.includes(a.session.split('=')[1]));assert(!a.html.includes(a.h.oauthCookie.split('=')[1]));
 assert.match(a.html,new RegExp('action="'+auth+'/oauth/authorize"'));assert.match(a.html,/name="handoff_grant"/);
 const accepted=await f.complete(a.h,a.html);assert.equal(accepted.status,302,await accepted.clone().text());
 const callback=new URL(accepted.headers.get('location'));assert.equal(callback.origin,'https://chatgpt.com');assert.equal(callback.searchParams.get('state'),'S'.repeat(32));
 assert.equal(callback.searchParams.has('handoff_grant'),false);assert.equal(callback.searchParams.has('customer_id'),false);
 const r=await f.exchange(callback.searchParams.get('code'));assert.equal(r.status,200,await r.clone().text());const tokens=await r.json();
 const link=f.db._sqlite.prepare('SELECT * FROM oauth_identity_token_links').get();assert.equal(link.customer_id,customer);assert.equal(link.tenant_id,principal.tenant_id);
 const me=await f.fetch(new Request(portal+'/v1/customer/me',{headers:{cookie:a.session}}));assert.equal(me.status,200,await me.clone().text());assert.equal((await me.json()).tenant_id,principal.tenant_id);
 f.env.MCP_CANONICAL_QUALIFIED='qualified_private_binding';let calls=0;
 f.env.MCP_CORE={fetch:async()=>{calls++;return Response.json({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'SYNTHETIC_EXECUTOR_ONLY'}],isError:false}});}};
 const mcp=withCanonicalMCPAdmission(published),message={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'musitu_axiom_execute',arguments:{operation:'arithmetic.evaluate',args:{expression:'40+2'}}}};
 const execute=()=>mcp.fetch(new Request(resource+'/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tokens.access_token},body:JSON.stringify(message)}),f.env);
 assert.equal((await execute()).status,200);assert.equal(calls,1);
 f.portal._sqlite.exec("UPDATE memberships SET status='revoked'");assert.equal((await f.fetch(new Request(portal+'/v1/customer/me',{headers:{cookie:a.session}}))).status,401);
 const denied=await execute(),body=await denied.json();assert(body.result?.isError||body.error);assert.equal(calls,1);
 assert.equal(f.handoffs._sqlite.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'redeemed');
 const proofReq=f.privateRequests.find(r=>r.url.endsWith('/identity/verify-oauth-session'));
 assert.equal(proofReq.headers.get('cookie'),a.h.oauthCookie);assert(!JSON.stringify(await proofReq.json()).includes(a.session));
});
test('portal verifier still refuses OAuth proof; private handoff is not a public route',async t=>{
 const f=setupHandoff(t),a=await f.approved();
 const r=await handleIdentityBinding(new Request('https://axiom-internal/session/verify',{method:'POST',headers:{cookie:a.session,'content-type':'application/json','x-axiom-audience':'axiom-chatgpt-oauth'},
 body:JSON.stringify({audience:'axiom-chatgpt-oauth',purpose:'customer-session',challenge:'a'.repeat(64),request_sha256:'b'.repeat(64)})}),f.env);
 assert.equal(r.status,401);
 assert.equal((await handleOAuthHandoffPrivate(new Request(portal+'/identity/verify-oauth-session',{method:'POST'}),f.env)).status,404);
 assert.equal((await f.fetch(new Request(portal+'/identity/verify-oauth-session',{method:'POST'}))).status,404);
});
test('missing independently imported ownership cannot be supplied by browser identity flags',async t=>{
 const f=setupHandoff(t,{owned:false}),h=await f.start(),session=await f.login(h);
 const r=await f.fetch(new Request(h.href,{headers:{cookie:session,'x-axiom-production-qualified':'true','x-axiom-customer-id':customer}}));
 assert.equal(r.status,401);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,0);
 assert.equal(f.handoffs._sqlite.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'requested');
});
for(const flag of ['OAUTH_HANDOFF_QUALIFIED','OAUTH_OWNERSHIP_QUALIFIED'])test('handoff qualification predicate '+flag+' cannot be omitted',async t=>{
 const f=setupHandoff(t);delete f.env[flag];const r=await handleOAuthHandoffPrivate(new Request('https://axiom-internal/oauth/handoff/create',{method:'POST'}),f.env);assert.equal(r.status,503);
});
test('different original OAuth browser cannot redeem, but does not consume the valid grant',async t=>{
 const f=setupHandoff(t),a=await f.approved();const wrong=await f.complete(a.h,a.html,{cookie:'__Host-axiom_oauth_flow='+'X'.repeat(43)});assert.equal(wrong.status,400);
 assert.equal(f.handoffs._sqlite.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'approved');assert.equal((await f.complete(a.h,a.html)).status,302);
});
test('handoff replay and concurrent completion issue exactly one authorization code',async t=>{
 const f=setupHandoff(t),a=await f.approved(),r=await Promise.all([f.complete(a.h,a.html),f.complete(a.h,a.html),f.complete(a.h,a.html)]);
 assert.equal(r.filter(x=>x.status===302).length,1);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,1);
 assert.equal((await f.complete(a.h,a.html)).status,400);
});
test('approval has one winner, and cannot be repeated to reissue a lost grant',async t=>{
 const f=setupHandoff(t),h=await f.start(),session=await f.login(h),c=await f.consent(h,session);
 const results=await Promise.all([f.approve(h,session,c),f.approve(h,session,c)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
 assert.equal((await f.fetch(new Request(h.href,{headers:{cookie:session+'; '+c.consentCookie}}))).status,401);
});
for(const [label,headers,status] of [
 ['foreign origin',{origin:'https://foreign.invalid'},401],['missing origin',{origin:''},401],
 ['duplicate OAuth cookie',{cookie:'__Host-axiom_oauth_flow='+'X'.repeat(43)+'; __Host-axiom_oauth_flow='+'X'.repeat(43)},401],
 ['authorization header',{authorization:'Bearer '+'X'.repeat(43)},401],['cookie domain spoof',{cookie:'musitu_oauth_flow='+'X'.repeat(43)},401]
])test(label+' denies before grant consumption',async t=>{
 const f=setupHandoff(t),a=await f.approved(),r=await f.complete(a.h,a.html,headers);assert.equal(r.status,status);
 assert.equal(f.handoffs._sqlite.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'approved');
});
for(const [label,which,sql] of [
 ['IdP logout','idp',"UPDATE customer_idp_sessions_v1 SET status='revoked',session_version=session_version+1"],
 ['canonical link','portal',"UPDATE canonical_customer_links SET status='revoked'"],
 ['membership','portal',"UPDATE memberships SET status='revoked'"],
 ['tenant','portal',"UPDATE tenants SET status='suspended'"],
 ['OAuth identity link','db',"UPDATE oauth_identity_links SET state='revoked',revoked_at='2026-11-23T00:00:00Z'"],
 ['production customer','db',"UPDATE customers SET status='suspended'"],
 ['independent ownership','handoffs',"UPDATE oauth_handoff_ownership_v1 SET status='revoked'"]
])test(label+' revocation between portal consent and OAuth redemption denies a code',async t=>{
 const f=setupHandoff(t),a=await f.approved();f[which]._sqlite.exec(sql);
 assert.equal((await f.complete(a.h,a.html)).status,401);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,0);
});
test('expiry and immutable OAuth context substitution deny an approved handoff',async t=>{
 for(const expired of [true,false]){
  const f=setupHandoff(t),a=await f.approved();if(expired)f.offset=300001;else f.db._sqlite.prepare('UPDATE oauth_authorization_flows SET state=?').run('T'.repeat(32));
  assert.equal((await f.complete(a.h,a.html)).status,401);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,0);
 }
});
test('grant is terminal after private response loss and cannot be reconstructed by retry',async t=>{
 const f=setupHandoff(t),a=await f.approved(),privateFetch=f.private;
 f.env.OAUTH_SESSION_VERIFIER={fetch:async request=>{const r=await privateFetch(request);if(request.url.endsWith('/identity/verify-oauth-session')&&r.status===200)throw Error('synthetic_lost_ack');return r;}};
 assert.equal((await f.complete(a.h,a.html)).status,401);assert.equal(f.handoffs._sqlite.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'redeemed');
 f.env.OAUTH_SESSION_VERIFIER={fetch:privateFetch};assert.equal((await f.complete(a.h,a.html)).status,401);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,0);
});
test('consent CSRF, duplicate fields and browser session substitution cannot approve',async t=>{
 const f=setupHandoff(t),h=await f.start(),session=await f.login(h),c=await f.consent(h,session);
 for(const [origin,cs,body] of [
  ['https://foreign.invalid',session+'; '+c.consentCookie,new URLSearchParams({csrf:c.csrf,consent:'approve'})],
  [portal,session+'; '+c.consentCookie,new URLSearchParams({csrf:'X'.repeat(43),consent:'approve'})],
  [portal,'__Host-axiom_customer='+'X'.repeat(43)+'; '+c.consentCookie,new URLSearchParams({csrf:c.csrf,consent:'approve'})],
  [portal,session+'; '+c.consentCookie,'csrf='+c.csrf+'&csrf='+c.csrf+'&consent=approve']
 ]){const r=await f.fetch(new Request(h.href,{method:'POST',headers:{cookie:cs,origin,'content-type':'application/x-www-form-urlencoded'},body}));assert([401,403].includes(r.status));}
 assert.equal(f.handoffs._sqlite.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'consent');
 assert.equal((await f.approve(h,session,c)).status,200);
});
test('handoff SQL prevents REPLACE, identity edits, NULL transitions, replay and deletion; failed batch rolls back',async t=>{
 const f=setupHandoff(t),h=await f.start(),db=f.handoffs._sqlite;
 for(const sql of ["UPDATE oauth_session_handoffs_v1 SET status='consent'", "UPDATE oauth_session_handoffs_v1 SET flow_id='other'", "DELETE FROM oauth_session_handoffs_v1",
  "INSERT OR REPLACE INTO oauth_session_handoffs_v1 SELECT * FROM oauth_session_handoffs_v1", "DELETE FROM oauth_handoff_ownership_v1",
  "INSERT OR REPLACE INTO oauth_handoff_ownership_v1 SELECT * FROM oauth_handoff_ownership_v1", "UPDATE oauth_handoff_ownership_v1 SET customer_id='other'"])
  assert.throws(()=>db.exec(sql));
 const session=await f.login(h),c=await f.consent(h,session);
 await assert.rejects(f.handoffs.batch([f.handoffs.prepare("UPDATE oauth_session_handoffs_v1 SET status='approved',grant_sha256=?,approved_at_ms=? WHERE id=?").bind('c'.repeat(64),Date.now(),h.id),
  f.handoffs.prepare("DELETE FROM oauth_handoff_ownership_v1")]));
 assert.equal(db.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'consent');
 const approved=await f.approve(h,session,c);assert.equal(approved.status,200);assert.equal((await f.complete(h,await approved.text())).status,302);
 assert.throws(()=>db.exec("UPDATE oauth_session_handoffs_v1 SET status='approved',redeemed_at_ms=NULL"));
 db.exec("UPDATE oauth_handoff_ownership_v1 SET status='revoked'");assert.throws(()=>db.exec("UPDATE oauth_handoff_ownership_v1 SET status='accepted'"));
});
test('upstream handoff response cannot set public cookies, inject HTML, choose callbacks or leak private errors',async t=>{
 const f=setupHandoff(t),h=await f.start();
 for(const response of [new Response('PRIVATE_ERROR',{status:500,headers:{'set-cookie':'evil=secret'}}),
  Response.json({kind:'login',handoff_id:h.id,redirect_uri:'https://evil.invalid'}),
  Response.json({kind:'complete',handoff_id:h.id,flow_id:'flow_'+'A'.repeat(32),grant:'<script>'}),
  new Response(null,{status:302,headers:{location:'https://evil.invalid','set-cookie':'evil=secret'}})]){
  f.env.CUSTOMER_OAUTH_HANDOFF_BROWSER={fetch:async()=>response.clone()};const r=await f.fetch(new Request(h.href));assert.equal(r.status,502);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('location'),null);assert(!/PRIVATE_ERROR|script|secret/.test(await r.text()));
 }
});
test('qualified handoff cannot be downgraded to a legacy-key or generic-session consent',async t=>{
 const f=setupHandoff(t),a=await f.approved(),flowId=input(a.html,'flow_id');
 for(const mode of ['legacy_key','verified_session']){
  const r=await f.fetch(new Request(auth+'/oauth/authorize',{method:'POST',headers:{origin:auth,cookie:a.h.oauthCookie+'; musitu_oauth_flow='+a.h.oauthCookie.split('=')[1]},
   body:new URLSearchParams({auth_mode:mode,flow_id:flowId,musitu_account_key:'synthetic-key'})}));assert.equal(r.status,401);
 }
 assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,0);assert.equal((await f.complete(a.h,a.html)).status,302);
});
test('oversized and duplicate authorization form fields deny without consuming the handoff',async t=>{
 const f=setupHandoff(t),a=await f.approved();
 for(const body of ['auth_mode=verified_handoff&x='+'X'.repeat(8192),
  new URLSearchParams({auth_mode:'verified_handoff',flow_id:input(a.html,'flow_id'),handoff_id:input(a.html,'handoff_id'),handoff_grant:input(a.html,'handoff_grant')}).toString()+'&auth_mode=legacy_key']){
  const r=await f.fetch(new Request(auth+'/oauth/authorize',{method:'POST',headers:{origin:portal,cookie:a.h.oauthCookie,'content-type':'application/x-www-form-urlencoded'},body}));assert([400,401].includes(r.status));
 }
 assert.equal(f.handoffs._sqlite.prepare('SELECT status FROM oauth_session_handoffs_v1').get().status,'approved');
 assert.equal((await f.complete(a.h,a.html,{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'})).status,302);
});
test('raw credentials and grant are absent from the persisted handoff namespace',async t=>{
 const f=setupHandoff(t),a=await f.approved(),stored=JSON.stringify(f.handoffs._sqlite.prepare('SELECT * FROM oauth_session_handoffs_v1').all());
 for(const secret of [a.session.split('=')[1],a.c.csrf,a.h.oauthCookie.split('=')[1],input(a.html,'handoff_grant')])assert(!stored.includes(secret));
 assert.equal((await f.complete(a.h,a.html)).status,302);
});
test('actual OAuth revoke endpoint denies an issued handoff token at userinfo and MCP',async t=>{
 const f=setupHandoff(t),a=await f.approved(),authorized=await f.complete(a.h,a.html),r=await f.exchange(new URL(authorized.headers.get('location')).searchParams.get('code')),
 tokens=await r.json();let calls=0;f.env.MCP_CANONICAL_QUALIFIED='qualified_private_binding';f.env.MCP_CORE={fetch:()=>{calls++;throw Error('execution_not_expected');}};
 const revoked=await f.fetch(new Request(auth+'/oauth/revoke',{method:'POST',body:new URLSearchParams({token:tokens.refresh_token})}));assert.equal(revoked.status,200);
 assert.equal((await f.fetch(new Request(auth+'/oauth/userinfo',{headers:{authorization:'Bearer '+tokens.access_token}}))).status,401);
 const response=await withCanonicalMCPAdmission(published).fetch(new Request(resource+'/mcp',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tokens.access_token},
 body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'musitu_axiom_execute',arguments:{operation:'arithmetic.evaluate',args:{expression:'40+2'}}}})}),f.env);
 const b=await response.json();assert(b.error||b.result?.isError);assert.equal(calls,0);
 assert.equal((await f.fetch(new Request(portal+'/v1/customer/me',{headers:{cookie:a.session}}))).status,200);
});
for(const [label,index,value] of [
 ['tenant',2,'different-tenant'],['existing UUID',3,'11111111-1111-4111-8111-111111111111'],['canonical proof digest',4,'c'.repeat(64)],
 ['OAuth witness digest',5,'c'.repeat(64)],['future acceptance',8,Date.now()+86400000]
])test('an ownership decision with a different '+label+' cannot qualify this account',async t=>{
 const f=setupHandoff(t,{owned:false}),insert=ownershipSQL(f.handoffs),values=insert._args();values[index]=value;
 if(index===8)values[9]=value+86400000;insert._stmt.run(...values);
 const h=await f.start(),session=await f.login(h);assert.equal((await f.fetch(new Request(h.href,{headers:{cookie:session}}))).status,401);
 assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM customers').get().n,1);
});
test('a handoff grant cannot be combined with another otherwise valid OAuth flow and browser cookie',async t=>{
 const f=setupHandoff(t),a=await f.approved(),other=await f.start(),flow=f.handoffs._sqlite.prepare('SELECT flow_id FROM oauth_session_handoffs_v1 WHERE id=?').get(other.id).flow_id;
 const substituted=a.html.replace(input(a.html,'flow_id'),flow);
 assert.equal((await f.complete(other,substituted)).status,401);assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_authorization_codes').get().n,0);
 assert.equal((await f.complete(a.h,a.html)).status,302);
});
test('the original ChatGPT PKCE verifier is still required after a successful handoff',async t=>{
 const f=setupHandoff(t),a=await f.approved(),r=await f.complete(a.h,a.html),code=new URL(r.headers.get('location')).searchParams.get('code');
 const bad=await f.fetch(new Request(auth+'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:'chatgpt-client',resource,
  redirect_uri:'https://chatgpt.com/connector/oauth/axiom',code,code_verifier:'X'.repeat(43)})}));assert.equal(bad.status,400);
 assert.equal(f.db._sqlite.prepare('SELECT count(*) n FROM oauth_access_tokens').get().n,0);assert.equal((await f.exchange(code)).status,200);
});
