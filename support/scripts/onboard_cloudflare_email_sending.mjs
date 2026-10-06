import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const SUPPORT_BRANCH='support/axiom-official-support-20261005';
const CONFIRM='ONBOARD_MUSITU_AXIOM_SUPPORT_EMAIL_SENDING';
const API='https://api.cloudflare.com/client/v4';
const ZONE_NAME='mftintelligence.com';
const SUPPORT_ALIAS='support@mftintelligence.com';
const BOUNCE='cf-bounce.mftintelligence.com';
const DKIM='cf-bounce._domainkey.mftintelligence.com';
const DMARC='_dmarc.mftintelligence.com';
const PROTECTED=[
  'auth.mftintelligence.com',
  'mcp.mftintelligence.com',
  'claude-auth.mftintelligence.com',
  'claude-mcp.mftintelligence.com',
];

function sha256(v){return createHash('sha256').update(String(v)).digest('hex');}
function norm(row){
  return {
    type:String(row?.type||'').toUpperCase(),
    name:String(row?.name||'').trim().toLowerCase().replace(/\.$/,''),
    content:String(row?.content||'').trim().replace(/\.$/,''),
    priority:row?.priority===null||row?.priority===undefined?null:Number(row.priority),
  };
}
function fp(rows){
  const a=(Array.isArray(rows)?rows:[]).map(norm).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)));
  return sha256(JSON.stringify(a));
}
function sameSnapshot(a,b){return a.count===b.count&&a.fingerprint_sha256===b.fingerprint_sha256;}

async function cf({fetchImpl,token,path,method='GET',body}){
  const r=await fetchImpl(API+path,{
    method,
    headers:{authorization:'Bearer '+token,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  let p={}; try{p=await r.json()}catch{}
  if(!r.ok||p?.success===false){
    const codes=Array.isArray(p?.errors)?p.errors.map(x=>x?.code).filter(x=>Number.isFinite(Number(x))).map(Number):[];
    const e=new Error(`Cloudflare ${method} ${path} failed HTTP ${r.status}; codes=${codes.join(',')||'none'}`);
    e.status=r.status; e.codes=codes; throw e;
  }
  return p?.result;
}

async function dnsRows({fetchImpl,token,zoneId,name}){
  const rows=await cf({fetchImpl,token,path:`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}&per_page=100`});
  return Array.isArray(rows)?rows:[];
}
async function snapshot({fetchImpl,token,zoneId,name}){
  const rows=await dnsRows({fetchImpl,token,zoneId,name});
  return {count:rows.length,fingerprint_sha256:fp(rows),rows};
}
async function protectedSnapshot(args){
  const out={};
  for(const host of PROTECTED){
    const s=await snapshot({...args,name:host});
    out[host]={count:s.count,fingerprint_sha256:s.fingerprint_sha256};
  }
  return out;
}
function sameProtected(a,b){
  return PROTECTED.every(h=>sameSnapshot(a[h],b[h]));
}
function safeDisabledDropAll(rule){
  if(rule?.enabled!==false) return false;
  const m=Array.isArray(rule?.matchers)?rule.matchers:[];
  const a=Array.isArray(rule?.actions)?rule.actions:[];
  return m.length===1&&String(m[0]?.type||'').toLowerCase()==='all'&&
    a.length===1&&String(a[0]?.type||'').toLowerCase()==='drop';
}
function targetsSupport(rule){
  return (Array.isArray(rule?.matchers)?rule.matchers:[]).some(m=>
    String(m?.type||'').toLowerCase()==='literal'&&
    String(m?.field||'').toLowerCase()==='to'&&
    String(m?.value||'').trim().toLowerCase()===SUPPORT_ALIAS
  );
}
function validSupportForward(rule){
  if(rule?.enabled!==true||!targetsSupport(rule)) return false;
  const actions=Array.isArray(rule?.actions)?rule.actions:[];
  return actions.length===1&&String(actions[0]?.type||'').toLowerCase()==='forward'&&
    Array.isArray(actions[0]?.value)&&actions[0].value.length===1;
}
async function inboundState({fetchImpl,token,zoneId}){
  const [routing,rules]=await Promise.all([
    cf({fetchImpl,token,path:`/zones/${zoneId}/email/routing`}),
    cf({fetchImpl,token,path:`/zones/${zoneId}/email/routing/rules`}),
  ]);
  const status=String(routing?.status||'').toLowerCase();
  const effective=(Array.isArray(rules)?rules:[]).filter(r=>!safeDisabledDropAll(r));
  const support=effective.filter(targetsSupport);
  return {
    ready:routing?.enabled===true&&['ready','active'].includes(status),
    exact_support_rule:effective.length===1&&support.length===1&&validSupportForward(support[0]),
  };
}
function sendingDnsShape({bounce,dkim,dmarc}){
  return {
    cf_bounce_mx_count:bounce.filter(r=>norm(r).type==='MX').length,
    cf_bounce_spf_count:bounce.filter(r=>norm(r).type==='TXT'&&norm(r).content.toLowerCase().startsWith('v=spf1')).length,
    dkim_count:dkim.filter(r=>norm(r).type==='TXT'&&norm(r).content.toLowerCase().startsWith('v=dkim1')).length,
    dmarc_count:dmarc.filter(r=>norm(r).type==='TXT'&&norm(r).content.toLowerCase().startsWith('v=dmarc1')).length,
  };
}

export async function onboardEmailSending({env=process.env,fetchImpl=fetch,now=new Date().toISOString()}={}){
  if(env.GITHUB_REF_NAME!==SUPPORT_BRANCH) throw new Error('Email Sending onboarding may run only from the isolated support branch');
  if(env.SUPPORT_EMAIL_SENDING_CONFIRM!==CONFIRM) throw new Error('Email Sending onboarding confirmation is missing');
  const zoneId=String(env.CLOUDFLARE_ZONE_ID||'').trim();
  const token=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!zoneId||!token) throw new Error('Cloudflare Email Sending credentials are not configured');

  const [rootBefore,bounceBefore,dkimBefore,dmarcBefore,protectedBefore,inboundBefore]=await Promise.all([
    snapshot({fetchImpl,token,zoneId,name:ZONE_NAME}),
    snapshot({fetchImpl,token,zoneId,name:BOUNCE}),
    snapshot({fetchImpl,token,zoneId,name:DKIM}),
    snapshot({fetchImpl,token,zoneId,name:DMARC}),
    protectedSnapshot({fetchImpl,token,zoneId}),
    inboundState({fetchImpl,token,zoneId}),
  ]);
  if(!inboundBefore.ready||!inboundBefore.exact_support_rule) throw new Error('inbound support routing is not in the verified ready state');
  if(bounceBefore.count||dkimBefore.count||dmarcBefore.count) throw new Error('sending-auth DNS namespace is not empty');

  let tag='';
  let created=false;
  try{
    const sending=await cf({
      fetchImpl,token,
      path:`/zones/${zoneId}/email/sending/subdomains`,
      method:'POST',
      body:{name:ZONE_NAME},
    });
    tag=String(sending?.tag||'');
    if(!tag||sending?.enabled!==true||String(sending?.name||'').toLowerCase()!==ZONE_NAME) throw new Error('Email Sending create response is not enabled for the root domain');
    created=true;

    const expected=await cf({fetchImpl,token,path:`/zones/${zoneId}/email/sending/subdomains/${encodeURIComponent(tag)}/dns`});
    const [rootAfter,bounceAfter,dkimAfter,dmarcAfter,protectedAfter,inboundAfter]=await Promise.all([
      snapshot({fetchImpl,token,zoneId,name:ZONE_NAME}),
      snapshot({fetchImpl,token,zoneId,name:BOUNCE}),
      snapshot({fetchImpl,token,zoneId,name:DKIM}),
      snapshot({fetchImpl,token,zoneId,name:DMARC}),
      protectedSnapshot({fetchImpl,token,zoneId}),
      inboundState({fetchImpl,token,zoneId}),
    ]);
    const shape=sendingDnsShape({bounce:bounceAfter.rows,dkim:dkimAfter.rows,dmarc:dmarcAfter.rows});
    if(shape.cf_bounce_mx_count!==3||shape.cf_bounce_spf_count!==1||shape.dkim_count!==1||shape.dmarc_count!==1) throw new Error('EMAIL_SENDING_DNS_NOT_EXACT');
    if(!Array.isArray(expected)||expected.length<5) throw new Error('EMAIL_SENDING_EXPECTED_DNS_UNAVAILABLE');
    if(!sameSnapshot(rootBefore,rootAfter)) throw new Error('ROOT_MAIL_DNS_DRIFT');
    if(!sameProtected(protectedBefore,protectedAfter)) throw new Error('PROTECTED_PROVIDER_DNS_DRIFT');
    if(!inboundAfter.ready||!inboundAfter.exact_support_rule) throw new Error('INBOUND_ROUTING_DRIFT');

    return {
      schema:'musitu.axiom.support-email-sending-onboard-evidence.v1',
      gate:'MUSITU_AXIOM_SUPPORT_EMAIL_SENDING_ONBOARD_PASS',
      recorded_at:now,
      repository:String(env.GITHUB_REPOSITORY||''),
      branch:String(env.GITHUB_REF_NAME||''),
      source_commit:String(env.GITHUB_SHA||''),
      sending:{enabled:true,domain_fingerprint_sha256:sha256(ZONE_NAME),raw_domain_recorded:false},
      created_dns:shape,
      inbound_routing:inboundAfter,
      root_mail_dns_unchanged:true,
      protected_provider_dns_unchanged:true,
      rollback:{performed:false},
      raw_destination_recorded:false,
      secret_exposed:false,
      public_support_deployed:false,
    };
  }catch(error){
    if(!created) throw error;
    let rollbackOk=false;
    try{
      await cf({fetchImpl,token,path:`/zones/${zoneId}/email/sending/subdomains/${encodeURIComponent(tag)}`,method:'DELETE'});
      const [root,bounce,dkim,dmarc,prot,inbound]=await Promise.all([
        snapshot({fetchImpl,token,zoneId,name:ZONE_NAME}),
        snapshot({fetchImpl,token,zoneId,name:BOUNCE}),
        snapshot({fetchImpl,token,zoneId,name:DKIM}),
        snapshot({fetchImpl,token,zoneId,name:DMARC}),
        protectedSnapshot({fetchImpl,token,zoneId}),
        inboundState({fetchImpl,token,zoneId}),
      ]);
      rollbackOk=sameSnapshot(rootBefore,root)&&sameSnapshot(bounceBefore,bounce)&&sameSnapshot(dkimBefore,dkim)&&sameSnapshot(dmarcBefore,dmarc)&&sameProtected(protectedBefore,prot)&&inbound.ready&&inbound.exact_support_rule;
    }catch{rollbackOk=false;}
    const code=String(error?.message||'EMAIL_SENDING_ONBOARD_FAILED').replace(/[^A-Z0-9_]/gi,'_').toUpperCase();
    if(rollbackOk) throw new Error(code+'_ROLLED_BACK');
    throw new Error(code+'_ROLLBACK_FAILED');
  }
}

export async function main(env=process.env,fetchImpl=fetch){
  const evidence=await onboardEmailSending({env,fetchImpl});
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const digest=sha256(serialized);
  const output=env.SUPPORT_EMAIL_SENDING_OUTPUT||'support-email-sending-onboard.json';
  await writeFile(output,serialized,{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile(output+'.sha256',digest+'  '+output+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify({gate:evidence.gate,sending_enabled:evidence.sending.enabled,root_mail_dns_unchanged:evidence.root_mail_dns_unchanged,protected_provider_dns_unchanged:evidence.protected_provider_dns_unchanged,evidence_sha256:digest})+'\n');
  return evidence;
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main();
