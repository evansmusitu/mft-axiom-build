import assert from 'node:assert/strict';
import test from 'node:test';
import {onboardEmailSending} from '../scripts/onboard_cloudflare_email_sending.mjs';

function response(status,payload){
  return {ok:status>=200&&status<300,status,async json(){return payload;}};
}

const zone='mftintelligence.com';
const bounce='cf-bounce.mftintelligence.com';
const dkim='cf-bounce._domainkey.mftintelligence.com';
const dmarc='_dmarc.mftintelligence.com';
const protectedHosts=['auth.mftintelligence.com','mcp.mftintelligence.com','claude-auth.mftintelligence.com','claude-mcp.mftintelligence.com'];

function mockCloudflare({postStatus=200, driftProtected=false}={}){
  const calls=[];
  const root=[
    {id:'mx1',type:'MX',name:zone,content:'route1.mx.cloudflare.net',priority:7},
    {id:'spf-root',type:'TXT',name:zone,content:'v=spf1 include:_spf.mx.cloudflare.net ~all'},
  ];
  const protectedMap=new Map(protectedHosts.map((h,i)=>[h,[{id:'p'+i,type:'AAAA',name:h,content:'2001:db8::'+(i+1)}]]));
  let sending=null;
  let bounceRows=[];
  let dkimRows=[];
  let dmarcRows=[];
  let rule={enabled:true,status:'ready'};
  const rules=[{id:'support-rule',enabled:true,matchers:[{type:'literal',field:'to',value:'support@mftintelligence.com'}],actions:[{type:'forward',value:['private@example.test']}]}];

  const rowsFor=name=>{
    if(name===zone) return root;
    if(name===bounce) return bounceRows;
    if(name===dkim) return dkimRows;
    if(name===dmarc) return dmarcRows;
    const rows=structuredClone(protectedMap.get(name)||[]);
    if(driftProtected&&sending&&name==='claude-mcp.mftintelligence.com') rows[0].content='2001:db8::ffff';
    return rows;
  };

  const fetchImpl=async(url,options={})=>{
    const u=new URL(url); const method=options.method||'GET';
    const body=options.body?JSON.parse(options.body):undefined;
    calls.push({method,path:u.pathname+u.search,body});

    if(u.pathname.endsWith('/email/routing')&&method==='GET') return response(200,{success:true,result:rule});
    if(u.pathname.endsWith('/email/routing/rules')&&method==='GET') return response(200,{success:true,result:rules});
    if(u.pathname.includes('/dns_records')&&method==='GET'){
      const name=u.searchParams.get('name');
      return response(200,{success:true,result:rowsFor(name)});
    }
    if(u.pathname.endsWith('/email/sending/subdomains')&&method==='POST'){
      if(postStatus!==200) return response(postStatus,{success:false,errors:[{code:10000}]});
      sending={tag:'send-1',name:zone,enabled:true};
      bounceRows=[
        {id:'bmx1',type:'MX',name:bounce,content:'route1.mx.cloudflare.net',priority:7},
        {id:'bmx2',type:'MX',name:bounce,content:'route2.mx.cloudflare.net',priority:32},
        {id:'bmx3',type:'MX',name:bounce,content:'route3.mx.cloudflare.net',priority:94},
        {id:'bspf',type:'TXT',name:bounce,content:'v=spf1 include:_spf.mx.cloudflare.net ~all'},
      ];
      dkimRows=[{id:'bdkim',type:'TXT',name:dkim,content:'v=DKIM1; h=sha256; k=rsa; p=TEST'}];
      dmarcRows=[{id:'dmarc',type:'TXT',name:dmarc,content:'v=DMARC1; p=reject;'}];
      return response(200,{success:true,result:sending});
    }
    if(u.pathname.endsWith('/email/sending/subdomains/send-1/dns')&&method==='GET'){
      return response(200,{success:true,result:[...bounceRows,...dkimRows,...dmarcRows]});
    }
    if(u.pathname.endsWith('/email/sending/subdomains/send-1')&&method==='DELETE'){
      sending=null; bounceRows=[]; dkimRows=[]; dmarcRows=[];
      return response(200,{success:true,result:null});
    }
    throw new Error('unexpected '+method+' '+u.pathname);
  };
  return {fetchImpl,calls,state:()=>({sending,bounceRows,dkimRows,dmarcRows})};
}

function env(){
  return {
    GITHUB_REPOSITORY:'evansmusitu/mft-axiom-build',
    GITHUB_REF_NAME:'support/axiom-official-support-20261005',
    GITHUB_SHA:'a'.repeat(40),
    SUPPORT_EMAIL_SENDING_CONFIRM:'ONBOARD_MUSITU_AXIOM_SUPPORT_EMAIL_SENDING',
    CLOUDFLARE_ZONE_ID:'zone-id',
    CLOUDFLARE_API_TOKEN:'masked-token',
  };
}

test('onboarding creates only sending-auth DNS and preserves inbound routing and protected provider DNS',async()=>{
  const mock=mockCloudflare();
  const evidence=await onboardEmailSending({fetchImpl:mock.fetchImpl,env:env(),now:'2026-10-06T06:05:00Z'});
  assert.equal(evidence.gate,'MUSITU_AXIOM_SUPPORT_EMAIL_SENDING_ONBOARD_PASS');
  assert.equal(evidence.sending.enabled,true);
  assert.equal(evidence.inbound_routing.ready,true);
  assert.equal(evidence.inbound_routing.exact_support_rule,true);
  assert.equal(evidence.root_mail_dns_unchanged,true);
  assert.equal(evidence.protected_provider_dns_unchanged,true);
  assert.equal(evidence.created_dns.cf_bounce_mx_count,3);
  assert.equal(evidence.created_dns.cf_bounce_spf_count,1);
  assert.equal(evidence.created_dns.dkim_count,1);
  assert.equal(evidence.created_dns.dmarc_count,1);
  assert.equal(evidence.rollback.performed,false);
  assert.equal(evidence.secret_exposed,false);
  assert.equal(JSON.stringify(evidence).includes('private@example.test'),false);
});

test('onboarding refuses preexisting sending-auth DNS before any write',async()=>{
  const mock=mockCloudflare();
  // Inject a preexisting record by answering through a wrapper.
  const base=mock.fetchImpl;
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url);
    if((options.method||'GET')==='GET'&&u.pathname.includes('/dns_records')&&u.searchParams.get('name')===bounce){
      return response(200,{success:true,result:[{id:'legacy',type:'TXT',name:bounce,content:'legacy'}]});
    }
    return base(url,options);
  };
  await assert.rejects(()=>onboardEmailSending({fetchImpl,env:env()}),/sending-auth DNS namespace is not empty/);
  assert.equal(mock.calls.some(c=>c.method==='POST'&&c.path.endsWith('/email/sending/subdomains')),false);
});

test('protected-provider drift after onboarding triggers sending-domain rollback',async()=>{
  const mock=mockCloudflare({driftProtected:true});
  await assert.rejects(()=>onboardEmailSending({fetchImpl:mock.fetchImpl,env:env()}),/PROTECTED_PROVIDER_DNS_DRIFT_ROLLED_BACK/);
  assert.equal(mock.state().sending,null);
  assert.equal(mock.state().bounceRows.length,0);
  assert.equal(mock.state().dkimRows.length,0);
  assert.equal(mock.state().dmarcRows.length,0);
});
