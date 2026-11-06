"""Reproduce initial9ac pagination evidence gap; synthetic only, no sockets."""
import importlib.util,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
p=Path(__file__).resolve().parent/'audit-original/customer_frontier/tests/test_existing_d1_catalog_binding_audit.py'
spec=importlib.util.spec_from_file_location('original_audit_probe',p)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def mutate(data):
 data['/pages/projects?page=1&per_page=100']['result_info']={'page':1,'per_page':100,'count':1,'total_count':3,'total_pages':2}
 data['/pages/projects?page=2&per_page=100']['result_info']={'page':2,'per_page':100,'count':0,'total_count':3,'total_pages':2}
rc,result,calls=module.CatalogBindings().run_subject(mutate)
print(json.dumps({'source':'9ac48710a7aff5590fa4d79b852f6cdba6d14001','case':'contradictory-optional-page-totals','exit':rc,'status':result['status'],'pages':result['pages'],'errors':result['errors'],'target_admitted':result['target_admitted']}))
assert rc==0 and result['pages']['status']=='OBSERVED_CURRENT_CONFIGS' and result['pages']['projects']==1
