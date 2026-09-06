import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendPlan} from './recommend.mjs';
import {renderStorefront,renderPlanDecision,renderVerifyRelease,renderSupport,renderPrivacy,renderTerms,renderSitemapXml,renderSecurityText,renderCheckout,renderSeatClaim,renderPaymentStatus} from './render.mjs';
import {RELEASE} from './content.mjs';
import {STOREFRONT_CSS,STOREFRONT_JS} from './assets.mjs';

const planViews={
  term:{id:'term',label:'Term',price:'US$4.99',term:'4 months',scope:'1 device'},
  annual:{id:'annual',label:'Annual',price:'US$9.99',term:'12 months',scope:'1 device'},
  lifetime:{id:'lifetime',label:'Lifetime',price:'US$19.99',term:'One-time',scope:'1 device'},
  family:{id:'family',label:'Family',price:'US$24.99',term:'12 months',scope:'up to 4 devices'},
  tutor:{id:'tutor',label:'Tutor',price:'US$39.00',term:'12 months',scope:'up to 10 devices'},
  school:{id:'school',label:'School',price:'from US$100/year',term:'12 months',scope:'volume seats'}
};

test('recommendation matrix is deterministic and advisory',()=>{
  const cases=[
    [{who:'myself',duration:'term'},'term'],
    [{who:'myself',duration:'year'},'annual'],
    [{who:'myself',duration:'permanent'},'lifetime'],
    [{who:'child',duration:'term'},'term'],
    [{who:'child',duration:'year'},'annual'],
    [{who:'child',duration:'permanent'},'lifetime'],
    [{who:'multiple',context:'home'},'family'],
    [{who:'multiple',context:'tutor'},'tutor'],
    [{who:'multiple',context:'school'},'school']
  ];
  for(const [input,expected] of cases) assert.equal(recommendPlan(input),expected,JSON.stringify(input));
  for(const input of [{},{who:'alien'},{who:'multiple',context:'unknown'},{who:'myself',duration:'forever'}]) assert.equal(recommendPlan(input),null,JSON.stringify(input));
});

test('storefront leads with product decisions, not seven equal paid cards',()=>{
  const page=renderStorefront({plans:planViews});
  assert.match(page,/MUSITU Chemistry Mastery/);
  assert.match(page,/>Start Free</);
  assert.match(page,/>Unlock Full Mastery</);
  assert.match(page,/>Families &amp; Institutions</);
  assert.match(page,/Example learner preview/);
  assert.match(page,/APK installation is free/i);
  assert.match(page,/Premium entitlement/i);
  const heroEnd=page.indexOf('</section>');
  assert.ok(heroEnd>0);
  const hero=page.slice(0,heroEnd);
  assert.equal((hero.match(/data-plan-id=/g)||[]).length,0,'hero must not render the full paid plan grid');
});

test('plan decision keeps every plan discoverable and never preselects paid access',()=>{
  const page=renderPlanDecision({plans:planViews,query:{who:'myself',duration:'year'}});
  assert.match(page,/Recommended for you/);
  assert.match(page,/Annual/);
  for(const id of Object.keys(planViews)) assert.match(page,new RegExp(`data-plan-id="${id}"`));
  assert.doesNotMatch(page,/checked(?:=|\s|>)/i);
  assert.doesNotMatch(page,/selected(?:=|\s|>)/i);
});

test('release verification exposes provenance without secret material',()=>{
  const page=renderVerifyRelease();
  for(const value of [RELEASE.version,RELEASE.sha256,RELEASE.bytesText,RELEASE.androidCertSha256,RELEASE.licenceKeyId,RELEASE.releaseDate,RELEASE.status]) assert.match(page,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  for(const secretName of ['CHEMISTRY_LICENSE_PKCS8_B64','PAYNOW_INTEGRATION_KEY','CLOUDFLARE_GLOBAL_API_KEY','CHEMISTRY_AUTHORITY_BRIDGE_TOKEN']) assert.equal(page.includes(secretName),false);
});

test('support is a lifecycle surface with the existing public support channel',()=>{
  const page=renderSupport();
  for(const text of ['Download latest version','Verify current version','Reinstall','Recover purchase','Activate licence','Claim another paid seat','Installation troubleshooting','WhatsApp']) assert.match(page,new RegExp(text,'i'));
  assert.match(page,/wa\.me\/263781572008/);
});

test('rendered pages include semantic accessibility foundations',()=>{
  const page=renderStorefront({plans:planViews});
  for(const token of ['<header','<nav','<main','<section','<footer','class="skip-link"','aria-live="polite"']) assert.ok(page.includes(token),token);
  assert.equal((page.match(/<h1\b/g)||[]).length,1);
  const plans=renderPlanDecision({plans:planViews,query:{who:'myself'}});
  assert.match(plans,/for="plan-who"/);
  assert.match(plans,/for="plan-duration"/);
});

test('assets are same-origin progressive enhancement with strict budgets',()=>{
  assert.ok(Buffer.byteLength(STOREFRONT_CSS,'utf8')<=24*1024);
  assert.ok(Buffer.byteLength(STOREFRONT_JS,'utf8')<=12*1024);
  assert.doesNotMatch(STOREFRONT_JS,/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\s*\(/);
  assert.doesNotMatch(STOREFRONT_JS,/https?:\/\//);
  assert.match(STOREFRONT_CSS,/:focus-visible/);
  assert.match(STOREFRONT_CSS,/prefers-reduced-motion/);
});

test('legal and public trust surfaces survive the global storefront upgrade',()=>{
  const privacy=renderPrivacy();
  assert.match(privacy,/Information processed for purchases/i);
  assert.match(privacy,/Data is not sold to advertisers/i);
  const terms=renderTerms();
  assert.match(terms,/Premium access is granted only by a valid MUSITU-signed licence after verified settlement/i);
  assert.match(terms,/does not guarantee a particular examination result/i);
  const sitemap=renderSitemapXml();
  for(const path of ['/chemistry/','/chemistry/plans','/chemistry/verify','/chemistry/releases','/chemistry/support','/chemistry/privacy','/chemistry/terms']) assert.match(sitemap,new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const security=renderSecurityText();
  assert.match(security,/Canonical: https:\/\/payments\.mftintelligence\.com\/chemistry\/security\.txt/);
  assert.match(security,/Policy: https:\/\/payments\.mftintelligence\.com\/chemistry\/terms/);
});

test('public pages link legal and support lifecycle surfaces in the global footer',()=>{
  const page=renderStorefront({plans:planViews});
  for(const path of ['/chemistry/privacy','/chemistry/terms','/chemistry/support','/chemistry/releases']) assert.ok(page.includes(path),path);
});

test('checkout presentation makes price scope and settlement boundary clear without changing form contract',()=>{
  const page=renderCheckout({planId:'annual',planLabel:'Annual',price:'US$9.99',scope:'12 months · 1 device',deviceId:'DEVICE-12345678',isSchool:false});
  for(const text of ['Confirm your access','Annual','US$9.99','12 months','1 device','Continue securely to Paynow','Device ID','verified settlement']) assert.match(page,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  for(const name of ['plan','holder','email','device_id']) assert.match(page,new RegExp(`name="${name}"`));
  assert.match(page,/action="\/chemistry\/checkout\/start"/);
});

test('school checkout retains seat control and explains volume pricing',()=>{
  const page=renderCheckout({planId:'school',planLabel:'School',price:'from US$100 / year',scope:'volume seats',deviceId:'SCHOOL-DEVICE-1234',isSchool:true});
  assert.match(page,/name="seats"/); assert.match(page,/min="1"/); assert.match(page,/max="999"/); assert.match(page,/server calculates the exact school price/i);
});

test('payment status presentation never invents entitlement for unpaid state',()=>{
  const pending=renderPaymentStatus({status:'pending',token:null,reference:'MC-TEST',secret:'',seats:1});
  assert.match(pending,/Payment verification in progress/i); assert.doesNotMatch(pending,/MUSITU1\./); assert.doesNotMatch(pending,/Activation licence ready/i);
  const paid=renderPaymentStatus({status:'paid',token:'MUSITU1.TEST.SIGNATURE',reference:'MC-TEST',secret:'',seats:1});
  assert.match(paid,/Activation licence ready/i); assert.match(paid,/MUSITU1\.TEST\.SIGNATURE/); assert.match(paid,/Download MUSITU Chemistry/i);
});

test('seat claim presentation preserves exact claim form contract',()=>{
  const page=renderSeatClaim();
  for(const name of ['reference','secret','device_id']) assert.match(page,new RegExp(`name="${name}"`));
  assert.match(page,/action="\/chemistry\/claim"/); assert.match(page,/Activate this seat/);
});
