"""Independent synthetic negative cases only; no sockets/source writes."""
import importlib.util,json
from pathlib import Path
p=Path('/workspace/scratch/cf664c251767/hosted-schema-readback/customer_frontier/tests/test_cloudflare_customer_schema_readonly.py')
s=importlib.util.spec_from_file_location('schema_review_tests',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
t=m.SchemaReadOnly()
rc,evidence,calls=t.run_subject(lambda p:p[1]['result'][0]['meta'].update(changed_db=True))
print(json.dumps({'case':'contradictory-changed-db-true','exit':rc,'status':evidence['status'],'mutations':evidence['mutations'],'query_changes':evidence['query_changes'],'query_rows_written':evidence['query_rows_written'],'requests':len(calls)}))
assert rc==0 and evidence['status']=='SCHEMA_CATALOG_OBSERVED' and evidence['mutations']==0
