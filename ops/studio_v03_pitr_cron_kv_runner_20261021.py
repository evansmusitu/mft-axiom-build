"""One-use, no-public-route Cloudflare hosted SQLite DO recovery qualification.

Creates ONLY an exact new throwaway Worker and an exact new KV receipt namespace.
Never addresses production DO IDs, R2 objects, Modal compute or Access policies.
Always attempts deletion and independently verifies both resources are gone.
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ACCOUNT=os.environ['CLOUDFLARE_ACCOUNT_ID']
TOKEN=os.environ.get('CLOUDFLARE_API_TOKEN') or os.environ.get('CF_API_TOKEN')
assert TOKEN and re.fullmatch(r'[a-f0-9]{32}',ACCOUNT)
BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT
WORKER='musitu-studio-v03-pitr-kv-e2e-20261021'
KV_NAME='musitu-studio-v03-pitr-proof-20261021'
CONFIG=pathlib.Path('wrangler.v03.disposable-pitr-kv-ci.jsonc')
PROOF=pathlib.Path('../../studio-v03-private-kv-pitr-proof-20261021.json')
namespace=None
attempted_worker=False
proof={'schema':'musitu.studio.v03.hosted-pitr-private-kv.v1',
 'isolated_worker_only':True,'isolated_kv_namespace_only':True,
 'no_public_route':True,'customer_records_accessed':False,
 'r2_objects_touched':False,'modal_compute_started':False,
 'production_v02_modified':False,'production_v03_modified':False,
 'hosted_pitr_restored':False,'provider_kv_receipt_obtained':False,
 'temporary_worker_absent_at_end':False,'temporary_kv_absent_at_end':False,
 'outcome':'NOT_STARTED'}

def call(method,path,data=None,raw=False):
    assert path.startswith('/') and not path.startswith('//')
    payload=json.dumps(data).encode() if data is not None else None
    headers={'Authorization':'Bearer '+TOKEN,'Accept':'application/json'}
    if data is not None:headers['Content-Type']='application/json'
    request=urllib.request.Request(BASE+path,method=method,headers=headers,data=payload)
    try:
        with urllib.request.urlopen(request,timeout=20) as response:
            content=response.read(20000)
            return response.status,(content if raw else json.loads(content))
    except urllib.error.HTTPError as exc:
        return exc.code,None
    except (OSError,ValueError):
        return 0,None

def must_result(method,path,data=None):
    code,x=call(method,path,data)
    assert code in (200,201) and isinstance(x,dict) and x.get('success') is True,(method,path.split('?')[0],code)
    return x.get('result')

try:
    assert call('GET','/workers/scripts/'+WORKER)[0]==404,'DISPOSABLE_WORKER_EXISTS'
    existing=must_result('GET','/storage/kv/namespaces?per_page=100')
    assert isinstance(existing,list) and len(existing)<100 and all(k.get('title')!=KV_NAME for k in existing),'DISPOSABLE_KV_NAME_OR_PAGINATION_RISK'
    domains=must_result('GET','/workers/domains')
    assert sum(d.get('service')=='musitu-studio-v03-do' and d.get('hostname')=='studio-v03.mftintelligence.com' for d in domains)==1
    assert sum(d.get('service')=='musitu-studio-v02' and d.get('hostname')=='studio.mftintelligence.com' for d in domains)==1
    newkv=must_result('POST','/storage/kv/namespaces',{'title':KV_NAME})
    namespace=newkv.get('id')
    assert isinstance(namespace,str) and re.fullmatch('[a-f0-9]{32}',namespace)
    config={'name':WORKER,'main':'../../ops/studio_v03_pitr_cron_kv_isolated_20261021.mjs',
      'compatibility_date':'2026-10-20','workers_dev':False,
      'triggers':{'crons':['* * * * *']},
      'kv_namespaces':[{'binding':'STUDIO_PITR_RECEIPTS','id':namespace}],
      'durable_objects':{'bindings':[{'name':'STUDIO_CRON_PITR','class_name':'StudioV03CronPitrProof'}]},
      'migrations':[{'tag':'studio-v03-private-kv-pitr-disposable-20261021',
                     'new_sqlite_classes':['StudioV03CronPitrProof']}]}
    CONFIG.write_text(json.dumps(config)+'\n')
    attempted_worker=True
    subprocess.run(['npx','wrangler','deploy','--config',str(CONFIG),'--outdir','.studio-v03-kv-pitr-ci'],
      stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=95)
    proof['outcome']='AWAITING_PRIVATE_CRON_PROOF'
    # Cron Trigger changes may need up to 15 minutes to propagate.
    deadline=time.monotonic()+1050
    while time.monotonic()<deadline:
        code,data=call('GET','/storage/kv/namespaces/'+namespace+'/values/receipt',raw=True)
        if code==200 and isinstance(data,bytes):
            try:receipt=json.loads(data)
            except (ValueError,UnicodeDecodeError):receipt=None
            if isinstance(receipt,dict):
                good=(receipt.get('schema')=='musitu.studio.v03.disposable.cron-pitr.v1' and
                  receipt.get('restored') is True and receipt.get('real_bookmark') is True and
                  receipt.get('mutated_before_restore') is True and
                  receipt.get('cron_only_no_public_ingress') is True and
                  receipt.get('customer_data_read') is False and
                  receipt.get('modal_compute_started') is False and
                  receipt.get('source_worker_preserved') is True)
                if good:
                    proof['hosted_pitr_restored']=True
                    proof['provider_kv_receipt_obtained']=True
                    proof['outcome']='Genuine hosted disposable SQLite PITR verified via private KV'
                    break
        time.sleep(12)
    assert proof['hosted_pitr_restored'],'HOSTED_PITR_NOT_PROVEN'
except (AssertionError,ValueError,TypeError,subprocess.SubprocessError) as err:
    proof['outcome']='FAIL_CLOSED_'+type(err).__name__
finally:
    # Never delete a name that was present before preflight. Cleanup starts only
    # after the exact temporary name was verified available.
    if attempted_worker:
        try:
            subprocess.run(['npx','wrangler','delete','--config',str(CONFIG)],
              input='y\n',text=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60,check=False)
        except subprocess.TimeoutExpired:
            pass  # Still independently check script absence and delete the KV.
    proof['temporary_worker_absent_at_end']=call('GET','/workers/scripts/'+WORKER)[0]==404
    if namespace:
        call('DELETE','/storage/kv/namespaces/'+namespace)
        proof['temporary_kv_absent_at_end']=call('GET','/storage/kv/namespaces/'+namespace)[0]==404
    else:
        proof['temporary_kv_absent_at_end']=True
    # Require full cleanup even after proof succeeds.
    if not (proof['temporary_worker_absent_at_end'] and proof['temporary_kv_absent_at_end']):
        proof['outcome']='CLEANUP_NOT_PROVEN'
    PROOF.write_text(json.dumps(proof,sort_keys=True,indent=2)+'\n')
    print('STUDIO_V03_PRIVATE_KV_HOSTED_PITR='+json.dumps(proof,sort_keys=True))
if not(proof['hosted_pitr_restored'] and proof['temporary_worker_absent_at_end'] and
       proof['temporary_kv_absent_at_end']):
    sys.exit(1)
