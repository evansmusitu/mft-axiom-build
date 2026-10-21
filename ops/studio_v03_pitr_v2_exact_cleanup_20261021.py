"""Delete ONLY the exact disposable V2 PITR Worker/KV after provider readback.

All other Cloudflare Workers, DO namespaces, Access and customer data are untouched.
Source-only until reviewed CI workflow executes with pre-existing scoped credentials.
"""
import json
import os
import pathlib
import time
import urllib.error
import urllib.request

ACCOUNT = os.environ['CLOUDFLARE_ACCOUNT_ID']
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN') or os.environ.get('CF_API_TOKEN')
assert len(ACCOUNT) == 32 and TOKEN
BASE = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT
WORKER = 'musitu-studio-v03-pitr-kv-v2-e2e-20261021'
KV_TITLE = 'musitu-studio-v03-pitr-v2-proof-20261021'
REPORT = pathlib.Path('studio-v03-disposable-pitr-v2-cleanup-20261021.json')
summary = {'schema':'musitu.studio.v03.pitr-v2-surgical-cleanup.v1',
           'read_only_except_disposable_cleanup': True,
           'existing_v02_v03_modified':False,
           'customer_durable_object_accessed':False,
           'customer_kv_values_read':False,
           'modal_compute_started':False,
           'worker_absent':False,
           'kv_namespace_absent':False,
           'outcome':'NOT_CHECKED'}

def req(method, path, json_body=False):
    assert path.startswith('/') and not path.startswith('//')
    h = {'Authorization':'Bearer ' + TOKEN, 'Accept':'application/json'}
    request=urllib.request.Request(BASE+path,headers=h,method=method)
    try:
        with urllib.request.urlopen(request,timeout=23) as r:
            if json_body:
                return r.status,json.load(r)
            return r.status,None
    except urllib.error.HTTPError as error:
        return error.code,None
    except (OSError,ValueError):
        return 0,None

def get_json(path):
    code,j=req('GET',path,True)
    assert code==200 and isinstance(j,dict) and j.get('success') is True, 'PROVIDER_READBACK_UNAVAILABLE'
    return j['result']

try:
    script='/workers/scripts/'+WORKER
    domains=get_json('/workers/domains')
    assert isinstance(domains,list)
    assert sum(d.get('hostname')=='studio-v03.mftintelligence.com' and d.get('service')=='musitu-studio-v03-do' for d in domains)==1
    assert sum(d.get('hostname')=='studio.mftintelligence.com' and d.get('service')=='musitu-studio-v02' for d in domains)==1
    assert all(d.get('service')!=WORKER for d in domains), 'TEMP_WORKER_HAS_DOMAIN_REFUSE_DELETE'
    names=get_json('/storage/kv/namespaces?per_page=100')
    assert isinstance(names,list) and len(names)<100, 'KV_PAGINATION_NOT_EXHAUSTIVE'
    exact=[x for x in names if x.get('title')==KV_TITLE]
    assert len(exact)<=1, 'DUPLICATE_DISPOSABLE_KV_TITLE'
    status,_=req('GET',script)
    summary['exact_worker_http_status_before_cleanup']=status
    if status==200:
        settings=get_json(script+'/settings')
        bindings=settings.get('bindings',[])
        assert isinstance(bindings,list)
        names=[b.get('name') for b in bindings]
        assert set(names)=={'STUDIO_CRON_PITR','STUDIO_PITR_RECEIPTS'}, 'TEMP_WORKER_BINDING_SCOPE_NOT_EXACT'
        assert any(b.get('name')=='STUDIO_CRON_PITR' and b.get('type')=='durable_object_namespace' for b in bindings)
        assert any(b.get('name')=='STUDIO_PITR_RECEIPTS' and b.get('type')=='kv_namespace' for b in bindings)
        if exact:
            assert any(b.get('name')=='STUDIO_PITR_RECEIPTS' and b.get('namespace_id')==exact[0].get('id') for b in bindings), 'TEMP_KV_ID_BINDING_MISMATCH'
        code,response=req('DELETE',script,True)
        summary['exact_worker_delete_http_status']=code
        assert code in (200,202) and isinstance(response,dict) and response.get('success') is True, 'EXACT_TEMP_DELETE_FAILED'
    else:
        assert status==404, 'AMBIGUOUS_SCRIPT_STATUS_FAIL_CLOSED'
    for attempt in range(5):
        code,_=req('GET',script)
        if code==404:break
        time.sleep(2)
    summary['worker_absent']=code==404
    assert summary['worker_absent'], 'DISPOSABLE_WORKER_NOT_CONFIRMED_DELETED'
    if exact:
        kv_id=exact[0]['id']
        code,response=req('DELETE','/storage/kv/namespaces/'+kv_id,True)
        summary['exact_kv_delete_http_status']=code
        assert code in (200,202) and isinstance(response,dict) and response.get('success') is True, 'EXACT_TEMP_KV_DELETE_FAILED'
    final=get_json('/storage/kv/namespaces?per_page=100')
    summary['kv_namespace_absent']=not any(x.get('title')==KV_TITLE for x in final)
    assert summary['kv_namespace_absent']
    summary['outcome']='EXACT_DISPOSABLE_RESOURCES_ABSENT'
except (AssertionError,KeyError,TypeError,ValueError) as error:
    summary['outcome']='FAIL_CLOSED_'+type(error).__name__
finally:
    REPORT.write_text(json.dumps(summary,sort_keys=True,indent=2)+'\n')
    print('STUDIO_V03_PITR_V2_CLEANUP='+json.dumps(summary,sort_keys=True))
assert summary['worker_absent'] and summary['kv_namespace_absent'], 'DISPOSABLE_CLEANUP_NOT_PROVEN'
