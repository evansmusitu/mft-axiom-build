"""Independent synthetic cases; source/transport are local and sockets disabled."""
import importlib.util,io,json,socket,urllib.error
from pathlib import Path
from unittest.mock import patch
path=Path('/workspace/scratch/cf664c251767/restore-target-reservation/customer_frontier/tests/test_restore_target_reservation.py')
spec=importlib.util.spec_from_file_location('reservation_cases',path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);subject=mod.RestoreTarget()
LIST='/d1/database?per_page=100&page=1';STAGE='/d1/database/a7384b8a-0751-4705-ac77-0616b0885e7c';NEW='/d1/database/77777777-7777-4777-8777-777777777777'
def run(case,mutate=lambda p:None,expected=1,state='NOT_ATTEMPTED',resources=0,**kw):
 with patch.object(socket,'socket',side_effect=AssertionError('network denied')):rc,out,calls=subject.run_subject(mutate,**kw)
 assert rc==expected,(case,out);assert out['creation_state']==state,(case,out);assert out['resource_creations']==resources,(case,out)
 assert len([r for r in calls if r.get_method()=='POST'])<=1
 assert out['billing_changes']==out['existing_resource_mutations']==out['customer_records_read']==out['sql_queries']==0
 assert not out['paid_upgrade_enabled'] and not out['backup_restore_qualified']
 print(json.dumps({'case':case,'exit':rc,'state':out['creation_state'],'resource_creations':out['resource_creations'],'requests':len(calls),'create_attempts':out['creation_attempts'],'error':out['error']}))
def inventory(n):
 def mutate(d):
  rows=d[LIST]['result']
  for i in range(n-2):
   ident=f'30000000-0000-4000-8000-{i:012d}';name='synthetic-extra-'+str(i);rows.append({'uuid':ident,'name':name});d['/d1/database/'+ident]={'success':True,'result':{'uuid':ident,'name':name,'file_size':1024}}
  d[LIST]['result_info'].update(count=n,total_count=n)
 return mutate
def http(status,body=None):return urllib.error.HTTPError('https://api.cloudflare.com',status,'PRIVATE-PROVIDER-DETAIL',{},io.BytesIO(json.dumps(body if body is not None else {'success':False,'errors':[{'code':7406,'message':'PRIVATE-PROVIDER-DETAIL'}]}).encode()))
run('20_database_boundary',inventory(20),expected=0,state='CREATED',resources=1)
run('21_databases_denied_before_create',inventory(21))
run('boolean_storage_denied',lambda d:d[STAGE]['result'].update(file_size=True))
run('negative_storage_denied',lambda d:d[STAGE]['result'].update(file_size=-1))
run('float_storage_denied',lambda d:d[STAGE]['result'].update(file_size=1.0))
run('metadata_identity_drift_denied',lambda d:d[STAGE]['result'].update(uuid='77777777-7777-4777-8777-777777777777'))
run('storage_budget_exact_boundary',lambda d:d[STAGE]['result'].update(file_size=64*1024*1024-1024),expected=0,state='CREATED',resources=1)
run('creation_malformed_uuid_unknown',lambda d:d['CREATE']['result'].update(uuid='not-a-uuid'),state='UNKNOWN',resources=None)
run('creation_wrong_name_unknown',lambda d:d['CREATE']['result'].update(name='foreign-target'),state='UNKNOWN',resources=None)
run('creation_2xx_unsuccessful_unknown',lambda d:d['CREATE'].update(success=False),state='UNKNOWN',resources=None)
run('creation_http408_unknown',create_exception=http(408),state='UNKNOWN',resources=None)
run('creation_http500_unknown',create_exception=http(500),state='UNKNOWN',resources=None)
run('creation_redirect303_unknown',create_exception=http(303),state='UNKNOWN',resources=None)
run('creation_4xx_success_true_unknown',create_exception=http(400,{'success':True}),state='UNKNOWN',resources=None)
run('creation_explicit_429_rejection',create_exception=http(429),state='REJECTED',resources=0)
run('creation_explicit_7406_rejection',create_exception=http(400),state='REJECTED',resources=0)
run('readback_wrong_identity_not_admitted',lambda d:d[NEW]['result'].update(name='foreign-target'),state='CREATED',resources=1)
run('readback_boolean_tables_not_empty',lambda d:d[NEW]['result'].update(num_tables=False),state='CREATED',resources=1)
run('readback_missing_table_count_not_empty',lambda d:d[NEW]['result'].pop('num_tables'),state='CREATED',resources=1)
run('readback_storage_over_cap_not_admitted',lambda d:d[NEW]['result'].update(file_size=65537),state='CREATED',resources=1)
run('readback_storage_boundary',lambda d:d[NEW]['result'].update(file_size=65536),expected=0,state='CREATED',resources=1)
