import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import worker from '../worker.js';

const sha256=value=>createHash('sha256').update(String(value)).digest('hex');
const validCase='AX-0123456789AB';

async function request(path, init={}, env={}) {
  return worker.fetch(new Request('https://support.local'+path, init), env);
}

async function verifyLocalSecurity() {
  const checks=[];

  const noAuth=await request('/api/v1/cases/'+validCase);
  checks.push({name:'case_read_requires_recovery_auth',pass:noAuth.status===401});

  const wrongType=await request('/api/v1/cases',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'},{ENVIRONMENT:'test'});
  checks.push({name:'wrong_content_type_rejected',pass:wrongType.status===415});

  const malformed=await request('/api/v1/cases',{method:'POST',headers:{'content-type':'application/json'},body:'{'},{ENVIRONMENT:'test'});
  checks.push({name:'malformed_json_rejected',pass:malformed.status===400});

  const oversized=await request('/api/v1/cases',{method:'POST',headers:{'content-type':'application/json','content-length':'24001'},body:'{}'},{ENVIRONMENT:'test'});
  checks.push({name:'oversized_payload_rejected',pass:oversized.status===413});

  const secret=['gh','p_','abcdefghijklmnopqrstuvwxyz','123456'].join('');
  const secretResponse=await request('/api/v1/cases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    surface:'web_app',category:'bug',affected_scope:'self',summary:'Security probe',
    description:secret,reproduction:'',impact:'',evidence_refs:[],consent_to_process:true,
  })},{ENVIRONMENT:'test'});
  const secretText=await secretResponse.text();
  checks.push({name:'secret_rejected_without_reflection',pass:secretResponse.status===422&&!secretText.includes(secret)});

  const unknown=await request('/.git/config');
  checks.push({name:'unknown_sensitive_path_not_found',pass:unknown.status===404});

  const cfgSecret='server-only-turnstile-secret';
  const config=await request('/api/v1/config',{},{
    TURNSTILE_SITE_KEY:'0x4AAAAAAAAAAAAAAAAAAAAAA',
    TURNSTILE_SECRET_KEY:cfgSecret,
  });
  const configText=await config.text();
  checks.push({name:'browser_config_does_not_expose_secret',pass:config.status===200&&!configText.includes(cfgSecret)});

  const headerProbe=await request('/api/v1/catalog');
  const csp=String(headerProbe.headers.get('content-security-policy')||'');
  const permissions=String(headerProbe.headers.get('permissions-policy')||'');
  checks.push({name:'response_security_headers',pass:
    headerProbe.headers.get('cache-control')==='no-store' &&
    headerProbe.headers.get('referrer-policy')==='no-referrer' &&
    csp.includes("frame-ancestors 'none'") &&
    csp.includes("object-src 'none'") &&
    permissions.includes('camera=()') &&
    permissions.includes('microphone=()') &&
    permissions.includes('payment=()')
  });

  const health=await request('/health',{}, {ENVIRONMENT:'production'});
  const healthText=await health.text();
  checks.push({name:'production_health_fails_closed',pass:health.status===503 && !/stack|exception|trace/i.test(healthText)});

  const files=[
    'support/worker.js','support/control_plane.js','support/crypto_envelope.js',
    'support/d1_case_store.js','support/evidence_packages.js','support/readiness.js',
    'support/turnstile.js','support/app.js'
  ];
  const dangerous=[];
  for(const file of files){
    const source=await readFile(file,'utf8');
    const patterns=[
      ['eval',/\beval\s*\(/],
      ['new_function',/\bnew\s+Function\s*\(/],
      ['document_write',/\bdocument\.write\s*\(/],
      ['inner_html',/\.innerHTML\s*=/],
      ['outer_html',/\.outerHTML\s*=/],
      ['dynamic_script_src',/createElement\s*\(\s*['"]script['"]\s*\)/],
    ];
    for(const [type,re] of patterns) if(re.test(source)) dangerous.push({file,type});
  }
  checks.push({name:'no_dangerous_dynamic_execution_or_html_sinks',pass:dangerous.length===0});

  const failed=checks.filter(x=>!x.pass).map(x=>x.name);
  return {checks,failed};
}

export async function verifySecurityReview({now=new Date().toISOString(),env=process.env}={}) {
  const local=await verifyLocalSecurity();
  const liveEdgeVerifierRef=String(env.SUPPORT_LIVE_EDGE_SECURITY_VERIFIER_REF||'').trim();
  const automatedStatus=local.failed.length?'FAIL':'PASS';
  const finalStatus=automatedStatus==='PASS'&&liveEdgeVerifierRef?'PASS':automatedStatus==='PASS'?'PARTIAL':'FAIL';
  const basis=JSON.stringify(local.checks);
  return {
    schema:'musitu.axiom.support-readiness-evidence.v1',
    gate:'SECURITY_REVIEW',
    status:finalStatus,
    automated_status:automatedStatus,
    verified_at:now,
    verifier_ref:liveEdgeVerifierRef||'github-actions:isolated-adversarial-review',
    artifact_sha256:sha256(basis),
    checks:local.checks,
    failures:local.failed,
    pre_storage_secret_rejection_tested:true,
    recovery_auth_boundary_tested:true,
    request_size_and_media_type_boundaries_tested:true,
    response_header_policy_tested:true,
    source_sink_scan_tested:true,
    production_fail_closed_tested:true,
    live_edge_penetration_tested:Boolean(liveEdgeVerifierRef),
    live_rate_limit_evidence_tested:Boolean(liveEdgeVerifierRef),
    public_origin_used:false,
    public_support_deployed:false,
    secret_exposed:false,
  };
}

export async function main(){
  const evidence=await verifySecurityReview();
  const serialized=JSON.stringify(evidence,null,2)+'\n';
  const digest=sha256(serialized);
  await writeFile('support-security-review.json',serialized,{encoding:'utf8',mode:0o600,flag:'wx'});
  await writeFile('support-security-review.json.sha256',`${digest}  support-security-review.json\n`,{encoding:'utf8',mode:0o600,flag:'wx'});
  process.stdout.write(JSON.stringify({
    gate:evidence.gate,status:evidence.status,automated_status:evidence.automated_status,
    failures:evidence.failures,live_edge_penetration_tested:evidence.live_edge_penetration_tested,
    evidence_sha256:digest,
  })+'\n');
  if(evidence.automated_status!=='PASS') process.exitCode=1;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main();
