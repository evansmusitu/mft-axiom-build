#!/usr/bin/env python3
import json, pathlib, hashlib, sys
from frontier_v5.runtime.retrieval_security import RetrievedContentFirewall

root=pathlib.Path(__file__).resolve().parents[1]
cases=json.loads((root/'evals/adversarial_retrieval_cases.json').read_text(encoding='utf-8'))
rows=[]; failed=[]
for c in cases:
    got=list(RetrievedContentFirewall.scan(c['text']))
    expected=sorted(c['flags'])
    ok=got==expected
    rows.append({'id':c['id'],'pass':ok,'expected':expected,'got':got})
    if not ok: failed.append(c['id'])
body=json.dumps(rows,sort_keys=True,separators=(',',':')).encode()
out={'schema':'musitu.axiom.frontier.adversarial.v2','count':len(rows),'failed':failed,'status':'PASS' if not failed else 'FAIL','suite_sha256':hashlib.sha256(body).hexdigest(),'rows':rows}
path=pathlib.Path('/tmp/musitu-frontier-adversarial.json'); path.write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps({'status':out['status'],'count':out['count'],'failed':failed,'suite_sha256':out['suite_sha256']}))
if failed:
    for row in rows:
        if not row['pass']:
            print(json.dumps(row,sort_keys=True))
    sys.exit(2)
print('MUSITU_AXIOM_FRONTIER_ADVERSARIAL_PASS')
