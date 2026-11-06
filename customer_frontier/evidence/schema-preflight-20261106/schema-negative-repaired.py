"""Independent original/repaired replay; synthetic provider, no sockets."""
import importlib.util,json
from pathlib import Path
out=Path('/workspace/scratch/cf664c251767/hosted-gate-review')
def subject(path):
 spec=importlib.util.spec_from_file_location('schema_replay_tests',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m.SchemaReadOnly()
original=subject(out/'schema-original/customer_frontier/tests/test_cloudflare_customer_schema_readonly.py')
rc,evidence,calls=original.run_subject(lambda p:p[1]['result'][0]['meta'].update(changed_db=True))
assert rc==0 and evidence['mutations']==0
print(json.dumps({'target':'original08b5','case':'changed_db_true','exit':rc,'status':evidence['status'],'mutations':evidence['mutations']}))
current=subject(Path('/workspace/scratch/cf664c251767/hosted-schema-readback/customer_frontier/tests/test_cloudflare_customer_schema_readonly.py'))
for value in [True,None,'false',0,0.0,[],{}]:
 rc,evidence,calls=current.run_subject(lambda p:p[1]['result'][0]['meta'].update(changed_db=value))
 assert rc==1 and evidence['status']=='INCOMPLETE' and evidence['mutations'] is None and evidence['objects']==[]
 print(json.dumps({'target':'repaired','case':'invalid_changed_db','value':value,'exit':rc,'status':evidence['status'],'mutations':evidence['mutations']}))
rc,evidence,calls=current.run_subject(lambda p:p[1]['result'][0]['meta'].pop('changed_db'))
assert rc==1 and evidence['mutations'] is None
rc,evidence,calls=current.run_subject()
assert rc==0 and evidence['query_changed_db'] is False and evidence['mutations']==0
print(json.dumps({'target':'repaired','case':'explicit_false_and_both_zero','exit':rc,'status':evidence['status'],'mutations':evidence['mutations']}))
