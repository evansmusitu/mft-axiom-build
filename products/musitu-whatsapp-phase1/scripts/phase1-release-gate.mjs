/** Evidence integrity and bounded observations never grant release authority. */
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const PHASE1_GATE_IDS=Object.freeze([
 'native_postgresql_17_migrations_rls_concurrency_recovery',
 'live_keycloak_oidc_and_membership_mfa',
 'authorized_meta_development_account_end_to_end',
 'approved_outbound_provider_delivery_reconciliation',
 'real_ai_model_qualified_quality_cost_privacy',
 'axiom_application_service_identity_and_gateway',
 'nextjs_customer_dashboard_prod_build',
 'owner_human_review_inbox_workflow',
 'monitoring_alerting_backup_restore',
 'independent_security_privacy_and_commercial_approval',
 'customer_consent_optout_external_requests_and_complaints'
]);

export function inspectPhase1Evidence({root=resolve(import.meta.dirname,'..'),register}={}){
 const report=register??JSON.parse(readFileSync(resolve(root,'docs/phase1/CURRENT_ACCEPTANCE.json'),'utf8'));
 if(report.schema!=='musitu.whatsapp.phase1.acceptance.v2'||report.publicReleaseAuthorized!==false||
    !Number.isFinite(Date.parse(report.observedAt))||report.environment!=='PRIVATE_STAGING_PROTECTED'||
    !Array.isArray(report.gates)||report.gates.length!==PHASE1_GATE_IDS.length)throw Error('ACCEPTANCE_REGISTER_REJECTED');
 const ids=new Set(),statuses=new Set(['CONFIRMED_BOUNDED','PARTIAL','BLOCKED']);
 const evidenceRoot=realpathSync(resolve(root,'evidence'))+sep;
 for(const gate of report.gates){
  if(!PHASE1_GATE_IDS.includes(gate.id)||ids.has(gate.id)||!statuses.has(gate.status)||
     typeof gate.scope!=='string'||!gate.scope.trim()||!Array.isArray(gate.evidence)||
     (gate.status==='CONFIRMED_BOUNDED'&&!gate.evidence.length))throw Error('ACCEPTANCE_REGISTER_REJECTED');
  ids.add(gate.id);
  for(const evidence of gate.evidence){
   if(typeof evidence.path!=='string'||!/^evidence\/20261023\/[a-z0-9-]+\.(json|log)$/.test(evidence.path)||
      !/^[a-f0-9]{64}$/.test(evidence.sha256??''))throw Error('ACCEPTANCE_EVIDENCE_REJECTED');
   const path=realpathSync(resolve(root,evidence.path));
   if(!path.startsWith(evidenceRoot)||createHash('sha256').update(readFileSync(path)).digest('hex')!==evidence.sha256)
    throw Error('ACCEPTANCE_EVIDENCE_REJECTED');
  }
 }
 return{status:'PHASE1_RELEASE_BLOCKED',environment:report.environment,observedAt:report.observedAt,
  evidenceIntegrity:'PASS',blocked:report.gates.filter(g=>g.status!=='CONFIRMED_BOUNDED').map(g=>g.id),
  boundedTechnicalEvidence:report.gates.filter(g=>g.status==='CONFIRMED_BOUNDED').map(g=>({id:g.id,scope:g.scope})),
  independentLiveApprovalRequired:true,publicReleaseAuthorized:false,
  note:'File integrity and stored observations cannot authorize customer effects, launch or merge.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(inspectPhase1Evidence(),null,2));}
 catch{console.log(JSON.stringify({status:'PHASE1_RELEASE_BLOCKED',evidenceIntegrity:'REJECTED',publicReleaseAuthorized:false}));}
 process.exitCode=2;
}
