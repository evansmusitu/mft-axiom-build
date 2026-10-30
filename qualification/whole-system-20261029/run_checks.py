"""Offline candidate checks. No deployment, credential or provider setup."""
from pathlib import Path
import argparse
import json
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--with-local-d1',action='store_true',help='also run isolated workerd/D1; requires the pinned Miniflare dependency')
args=parser.parse_args()
OUT=Path(__file__).resolve().parent/'check-results'
OUT.mkdir(exist_ok=True)
def files(pattern):return [str(p.relative_to(ROOT)) for p in sorted(ROOT.glob(pattern))]
CHECKS={
 'application':['node','--test','--test-concurrency=2',*files('axiom_interface/vnext/tests/*.test.mjs'),*files('axiom_interface/tests/*.test.mjs')],
 'phase1':['node','--test',*files('reasoning/phase1/tests/*.test.ts')],
 'phase2':['node','--disable-warning=ExperimentalWarning','--test','--test-concurrency=2',*files('reasoning/phase2/tests/*.test.ts')],
 'frontier':['python3','-m','unittest','frontier_v5.tests.test_integrity_repairs','frontier_v5.tests.test_decision_analysis','frontier_v5.tests.test_d1_memory_schema','-v'],
 'recovery':['python3','-m','unittest','discover','-s','recovery/ar03_06/tests','-v'],
 'recovery_application':['python3','-m','unittest','discover','-s','recovery/ar07_09/tests','-v'],
 'multiplatform':['python3','-m','unittest','discover','-s','multiplatform/tests','-v'],
 'frontier_qualification':['python3','-m','frontier_v5.scripts.qualify_local_capabilities','--output',str(OUT/'local-qualification.json')],
 'frontier_extended':['python3','-m','unittest','frontier_v5.tests.test_capability_qualification_extended','-v'],
 'decision_robustness':['python3','-m','unittest','frontier_v5.tests.test_decision_probability_robustness','-v'],
 'frontier_contracts':['python3','-m','frontier_v5.scripts.run_offline_contracts','--output',str(OUT/'frontier-contracts.json')],
 'decision_skill':['python3','-m','frontier_v5.scripts.skill_lint','frontier_v5/skill_candidates/musitu-decision-tradeoffs'],
}
if args.with_local_d1:
 CHECKS['local_d1']=['node','--test','qualification/whole-system-20261029/d1-local.test.mjs']
results={}
for name,command in CHECKS.items():
 start=time.monotonic()
 with (OUT/(name+'.log')).open('w') as output:
  try:
   result=subprocess.run(command,cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,timeout=180)
   code=result.returncode
  except subprocess.TimeoutExpired:code=124
 results[name]={'command':command,'exit':code,'seconds':round(time.monotonic()-start,3),'log':name+'.log'}
 (OUT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps({name:{'exit':code,'seconds':results[name]['seconds']}}),flush=True)
raise SystemExit(any(result['exit'] for result in results.values()))
