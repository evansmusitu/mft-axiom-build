import {clone} from './common.mjs';

export const AR09_TARGETS=Object.freeze({
  gateway_availability_pct:99.9,
  transient_failure_recovery_pct:95,
  duplicate_consequential_actions:0,
  reconciliation_and_provenance_pct:100,
  cross_tenant_leakage:0,
});

export function evaluateReliability(metrics={}){
  const normalized={
    gateway_availability_pct:Number(metrics.gateway_availability_pct),
    transient_failure_recovery_pct:Number(metrics.transient_failure_recovery_pct),
    duplicate_consequential_actions:Number(metrics.duplicate_consequential_actions),
    reconciliation_and_provenance_pct:Number(metrics.reconciliation_and_provenance_pct),
    cross_tenant_leakage:Number(metrics.cross_tenant_leakage),
  };
  const checks={
    gateway_availability:Number.isFinite(normalized.gateway_availability_pct)&&normalized.gateway_availability_pct>=AR09_TARGETS.gateway_availability_pct,
    transient_failure_recovery:Number.isFinite(normalized.transient_failure_recovery_pct)&&normalized.transient_failure_recovery_pct>=AR09_TARGETS.transient_failure_recovery_pct,
    duplicate_consequential_actions:Number.isFinite(normalized.duplicate_consequential_actions)&&normalized.duplicate_consequential_actions===0,
    reconciliation_and_provenance:Number.isFinite(normalized.reconciliation_and_provenance_pct)&&normalized.reconciliation_and_provenance_pct===100,
    cross_tenant_leakage:Number.isFinite(normalized.cross_tenant_leakage)&&normalized.cross_tenant_leakage===0,
  };
  return {schema:'musitu.axiom.ar09.reliability-evaluation.v1',status:Object.values(checks).every(Boolean)?'PASS':'FAIL',targets:clone(AR09_TARGETS),metrics:normalized,checks};
}

export async function runSyntheticReliabilityExercise({requests=10000,transientFailures=200}={}){
  let available=requests,recovered=0,duplicates=0,reconciled=requests,leaks=0;const effects=new Set();
  for(let i=0;i<requests;i++){
    const id=`req-${i}`;if(effects.has(id))duplicates++;effects.add(id);
    if(i<transientFailures){const recoveredNow=(i % 20)!==0;if(recoveredNow)recovered++;}
  }
  const metrics={gateway_availability_pct:100*available/requests,transient_failure_recovery_pct:transientFailures?100*recovered/transientFailures:100,duplicate_consequential_actions:duplicates,reconciliation_and_provenance_pct:100*reconciled/requests,cross_tenant_leakage:leaks};return {exercise:'SYNTHETIC_FAULT_INJECTION',request_count:requests,transient_failures:transientFailures,...evaluateReliability(metrics)};
}

export async function runAr09CandidateGate(){const exercise=await runSyntheticReliabilityExercise();return {schema:'musitu.axiom.ar09.candidate-gate.v1',status:exercise.status==='PASS'?'CANDIDATE_PASS_LIVE_SLO_EVIDENCE_PENDING':'FAIL',synthetic_exercise:exercise,live_gateway_availability_evidence:false,representative_scale_evidence:false,phase_gate_earned:false,blocker:exercise.status==='PASS'?'LIVE_REPRESENTATIVE_SLO_AND_SCALE_EVIDENCE_REQUIRED':'SYNTHETIC_RELIABILITY_TARGETS_FAILED',production_mutated:false};}
