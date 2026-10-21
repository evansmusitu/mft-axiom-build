"""Read-only snapshot of one exact disposable hosted PITR KV proof. No secrets logged."""
import json, os, pathlib, urllib.error, urllib.request
account=os.environ['CLOUDFLARE_ACCOUNT_ID']
token=os.environ.get('CLOUDFLARE_API_TOKEN') or os.environ.get('CF_API_TOKEN')
base='https://api.cloudflare.com/client/v4/accounts/'+account
report={'schema':'musitu.studio.v03.pitr-progress-readonly.v1','read_only':True,'mutated':False,
 'staff_data_logged':False,'worker_present':False,'namespace_present':False,
 'receipt_present':False,'provider_bookmark_observed':False,'provider_restore_observed':False}
def call(path,raw=False):
    req=urllib.request.Request(base+path,headers={'Authorization':'Bearer '+token})
    try:
        with urllib.request.urlopen(req,timeout=15) as r:
            b=r.read(25000)
            return r.status,b if raw else json.loads(b)
    except urllib.error.HTTPError as e:return e.code,None
    except (OSError,ValueError):return 0,None
c,_=call('/workers/scripts/musitu-studio-v03-pitr-kv-e2e-20261021')
report['worker_present']=c==200
c,existing=call('/storage/kv/namespaces?per_page=100')
if c==200 and isinstance(existing,dict) and existing.get('success') and isinstance(existing.get('result'),list):
    found=[x for x in existing['result'] if x.get('title')=='musitu-studio-v03-pitr-proof-20261021']
    if len(found)==1:
        report['namespace_present']=True
        namespace=found[0]['id']
        code,raw=call('/storage/kv/namespaces/'+namespace+'/values/receipt',raw=True)
        if code==200:
            report['receipt_present']=True
            try:seen=json.loads(raw)
            except ValueError:seen={}
            if isinstance(seen,dict) and seen.get('schema')=='musitu.studio.v03.disposable.cron-pitr.v1':
                report['provider_bookmark_observed']=seen.get('real_bookmark') is True
                report['provider_restore_observed']=seen.get('restored') is True
                report['mutation_observed']=seen.get('mutated_before_restore') is True
path=pathlib.Path('studio-v03-private-kv-pitr-progress-readonly.json')
path.write_text(json.dumps(report,sort_keys=True,indent=2)+'\n')
print('STUDIO_V03_PRIVATE_KV_PITR_PROGRESS='+json.dumps(report,sort_keys=True))
