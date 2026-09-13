#!/usr/bin/env python3
from __future__ import annotations
import json, os, subprocess, sys, tempfile

def run(args, *, env=None, capture=False):
 e=os.environ.copy();e['PYTHONPATH']='.'
 if env:e.update(env)
 if capture:return subprocess.check_output(args,text=True,env=e)
 subprocess.check_call(args,env=e)

def main():
 run([sys.executable,'-m','compileall','-q','frontier_review_safe','frontier_v5/runtime','axiom_interface/tests'])
 run([sys.executable,'-m','unittest','discover','-s','axiom_interface/tests','-p','test_*.py','-v'])
 for p in ['frontier_v5/tests/test_durable_tasks.py','frontier_v5/tests/test_persistent_planner.py','frontier_v5/tests/test_outcome_contract_runtime.py','frontier_v5/tests/test_claim_graph_quality.py','frontier_v5/tests/test_artifact_engine.py','frontier_v5/tests/test_observability.py','frontier_v5/tests/test_live_session.py','frontier_v5/tests/test_computer_execution.py']:
  run([sys.executable,p])
 run([sys.executable,'-m','unittest','frontier_v5.tests.test_freshness_contract','frontier_v5.tests.test_claim_graph_integrity','-v'])
 run([sys.executable,'-m','unittest','discover','-s','frontier_review_safe/tests','-v'])
 with tempfile.NamedTemporaryFile(suffix='.json',delete=False) as f: scale=f.name
 try:
  out=run([sys.executable,'-m','frontier_review_safe.scale_benchmarks'],capture=True);open(scale,'w',encoding='utf-8').write(out)
  data=json.loads(out);assert data['candidate_sha']==os.environ.get('GITHUB_SHA',data['candidate_sha']);assert len(data['benchmarks'])==7;assert all(x['throughput_per_sec']>0 and x['peak_python_bytes']>=0 for x in data['benchmarks'])
  workload=subprocess.check_output(['git','hash-object','frontier_review_safe/scale_benchmarks.py'],text=True).strip();run([sys.executable,'-m','frontier_review_safe.scale_budget',scale,workload])
 finally:
  try:os.unlink(scale)
  except OSError:pass
 out=run([sys.executable,'-m','frontier_review_safe.scale_experiments'],capture=True);data=json.loads(out)
 from frontier_review_safe.scale_experiments import validate_experimental_evidence
 result=validate_experimental_evidence(data);assert result['status']=='PASS' and result['promotion_status']=='MEASUREMENT_ONLY_UNBUDGETED' and result['budget_authorized'] is False and result['claim_authorized'] is False
 run([sys.executable,'frontier_v5/scripts/run_phase8_security_gate.py'])
 print('MUSITU_AXIOM_INTERFACE_PHASE8_RUNTIME_REGRESSION_PASS')
if __name__=='__main__': main()
