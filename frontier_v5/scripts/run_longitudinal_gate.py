#!/usr/bin/env python3
import json, pathlib, hashlib, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
baseline=json.loads((ROOT/'evals/LONGITUDINAL_BASELINE.json').read_text())['minimums']

def load(path): return json.loads(pathlib.Path(path).read_text())
adv=load('/tmp/musitu-frontier-adversarial.json')
live=load('/tmp/musitu-frontier-live-evidence.json')
ind=load('/tmp/musitu-frontier-independent-validation.json')
mm=load('/tmp/musitu-frontier-multimodal.json')
checks=live.get('checks',{})
metrics={
 'local_fullstack_pass':1,
 'multimodal_modalities':len(mm.get('modalities',[])),
 'adversarial_cases':int(adv.get('count',0)),
 'adversarial_pass_rate':(int(adv.get('count',0))-len(adv.get('failed',[])))/max(1,int(adv.get('count',0))),
 'live_required_checks':sum(1 for v in checks.values() if isinstance(v,dict) and v.get('pass') is True),
 'live_required_pass_rate':sum(1 for v in checks.values() if isinstance(v,dict) and v.get('pass') is True)/max(1,len(checks)),
 'independent_validators':len(ind.get('validators',[])),
 'sealed_comparative_holdout_cases':int((checks.get('sealed_external_comparative') or {}).get('holdout_count',0)),
 'specialist_tool_bindings':len((checks.get('specialist_tool_adapters') or {}).get('bindings',[])),
}
regressions={k:{'actual':metrics.get(k),'minimum':v} for k,v in baseline.items() if metrics.get(k,0)<v}
out={'schema':'musitu.axiom.frontier.longitudinal.v1','metrics':metrics,'minimums':baseline,'regressions':regressions,'status':'PASS' if not regressions else 'FAIL'}
body=json.dumps(out,sort_keys=True,separators=(',',':')).encode(); out['evidence_sha256']=hashlib.sha256(body).hexdigest()
pathlib.Path('/tmp/musitu-frontier-longitudinal.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps({'status':out['status'],'metrics':metrics,'evidence_sha256':out['evidence_sha256']},indent=2))
if regressions: sys.exit(2)
print('MUSITU_AXIOM_FRONTIER_LONGITUDINAL_REGRESSION_PASS')
