/** Security Authority 2: operator-side read-only retention-policy preflight.
 * Execute ONLY outside builder-owned CI. Never accept a credential as a CLI
 * argument, expose provider responses, or print an authentication token.
 */
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {verifyAuthority2R2LockPolicy} from './authority2-lock-policy.mjs';
import {verifyAuthority2WorkerBindings} from './authority2-worker-bindings.mjs';
import {verifyAuthority2ActiveDeployment} from './authority2-active-deployment.mjs';

const ACCOUNT='67469478aa9349fa0a57fe3a72da200a';
const BUCKET='musitu-axiom-b27-highwater-a2';
const KEY='AXIOM_AUTHORITY2_CLOUDFLARE_R2_READ_TOKEN';
const WORKERS_KEY='AXIOM_AUTHORITY2_CLOUDFLARE_WORKERS_READ_TOKEN';

export async function operatorReadOnlyPreflight({
  env=process.env,argv=process.argv,
  verify=verifyAuthority2R2LockPolicy,
  verifyWorker=verifyAuthority2WorkerBindings,
  verifyDeployment=verifyAuthority2ActiveDeployment,
  output=message=>process.stdout.write(message+'\n'),
  error=message=>process.stderr.write(message+'\n')
}={}){
  // No GitHub Actions or shared builder runtime ever sees operator-owned keys.
  if(env.GITHUB_ACTIONS==='true'||env.CI==='true'||env.AXIOM_BUILDER_RUNTIME==='true'){
    error('AUTHORITY2_OPERATOR_ENVIRONMENT_REQUIRED_HOLD');return 2;
  }
  if(argv.length!==2){error('AUTHORITY2_NO_CREDENTIAL_ARGUMENTS_ALLOWED_HOLD');return 2;}
  const token=env[KEY];
  // Optional distinct operator-owned Workers read credential. This permits
  // a least-privilege R2 token to remain R2-only; never request broader
  // privileges or access tokens from builder CI.
  const workersReadToken=Object.hasOwn(env,WORKERS_KEY)?env[WORKERS_KEY]:token;
  if(!token){error('AUTHORITY2_READ_ONLY_CREDENTIAL_MISSING_HOLD');return 2;}
  try{
    const result=await verify({account_id:ACCOUNT,bucket_name:BUCKET,token});
    if(result.account_id!==ACCOUNT||result.bucket_name!==BUCKET||
      result.retention!=='Indefinite'||result.admin_removable!==true||
      typeof result.rule_id!=='string'||result.rule_id.length===0){
      error('AUTHORITY2_POLICY_EVIDENCE_INCONSISTENT_HOLD');return 2;
    }
    const worker=await verifyWorker({account_id:ACCOUNT,token:workersReadToken});
    if(worker?.account_id!==ACCOUNT||worker.script_name!=='axiom-security-authority2-highwater'||
      worker.bucket_name!==BUCKET||worker.checked_binding_count!==5||
      worker.active_deployment_verified!==false||worker.signer_custody_verified!==false||
      worker.release_eligible!==false){
      error('AUTHORITY2_WORKER_EVIDENCE_INCONSISTENT_HOLD');return 2;
    }
    const deployment=await verifyDeployment({account_id:ACCOUNT,token:workersReadToken});
    if(deployment?.account_id!==ACCOUNT||
      deployment.script_name!=='axiom-security-authority2-highwater'||
      deployment.active_deployment_metadata_observed!==true||
      deployment.active_deployment_source_qualified!==false||
      deployment.release_eligible!==false||
      !/^[0-9a-f]{64}$/.test(deployment.active_version_id_sha256??'')||
      !/^[0-9a-f]{64}$/.test(deployment.deployment_id_sha256??'')){
      error('AUTHORITY2_DEPLOYMENT_EVIDENCE_INCONSISTENT_HOLD');return 2;
    }
    // No raw HTTP body, bearer value, usernames, or account permissions.
    output(JSON.stringify({
      schema:'musitu.axiom.authority2.operator-policy-readback.v1',
      account_id:ACCOUNT,bucket_name:BUCKET,
      rule_id_sha256:createHash('sha256').update(result.rule_id).digest('hex'),
      scope:result.scope,retention:'Indefinite',provider:'Cloudflare R2 + Workers',
      worker_script_name:worker.script_name,worker_binding_count:worker.checked_binding_count,
      active_deployment_verified:false,signer_custody_verified:false,
      active_deployment_metadata_observed:true,
      active_deployment_source_qualified:false,
      active_version_id_sha256:deployment.active_version_id_sha256,
      deployment_id_sha256:deployment.deployment_id_sha256,
      checked_at:new Date().toISOString(),credential_exposed:false,
      independently_verified:false,admin_rollback_resistance:'NOT_PROVEN',
      release_eligible:false,status:'PROVIDER_POLICY_READBACK_ONLY_NOT_RELEASE'
    }));
    return 0;
  }catch(e){
    // Never print e.message / stack / underlying response. They could include
    // an auth-bearing URL or untrusted provider data.
    const code=typeof e?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(e.code)?
      e.code:'PROVIDER_POLICY_VERIFICATION_UNAVAILABLE_HOLD';
    error(code);return 2;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const status=await operatorReadOnlyPreflight();
  process.exitCode=status;
}
