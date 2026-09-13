import hashlib, json, os, urllib.error, urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
DB_ID=os.environ['FMI_DB_UUID']
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Revenue-Reconcile-Schema/1.0'}

def http(url, method='GET', headers=None, body=None):
    req=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:return r.status,r.read()
    except urllib.error.HTTPError as e:return e.code,e.read()

def d1(sql):
    h=dict(H);h['Content-Type']='application/json'
    code,raw=http(f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query','POST',h,json.dumps({'sql':sql},separators=(',',':')).encode())
    if code!=200:raise RuntimeError(f'D1 HTTP {code}')
    x=json.loads(raw or b'{}');rows=[]
    if x.get('success') is False:raise RuntimeError('D1 success=false')
    for rr in x.get('result') or []:
        if rr.get('success') is not True:raise RuntimeError('D1 statement failed')
        rows.extend(rr.get('results') or [])
    return rows

tables=['customers','api_keys','billing_checkout_intents','billing_subscriptions','lifecycle_events','usage_events','usage_buckets','webhook_events']
out={'schema':'musitu.fmi.revenue-reconcile-schema.v1','mutation_performed':False,'secret_values_read_or_logged':False,'tables':{}}
for table in tables:
    exists=d1("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='"+table.replace("'","''")+"'")
    present=bool(exists and int(exists[0].get('n') or 0)==1)
    item={'present':present,'columns':[]}
    if present:
        cols=d1('PRAGMA table_info("'+table.replace('"','""')+'");')
        item['columns']=[{'name':c.get('name'),'type':c.get('type'),'notnull':c.get('notnull'),'pk':c.get('pk')} for c in cols]
    out['tables'][table]=item
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
open('fmi-revenue-reconcile-schema.json','wb').write(blob)
dg=hashlib.sha256(blob).hexdigest();open('fmi-revenue-reconcile-schema.sha256','w').write(dg+'  fmi-revenue-reconcile-schema.json\n')
print(json.dumps({'gate':'FMI_REVENUE_RECONCILE_SCHEMA_READONLY_PASS','present':{k:v['present'] for k,v in out['tables'].items()},'evidence_sha256':dg,'mutation_performed':False},sort_keys=True))
