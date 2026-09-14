import hashlib
import json
import os
import urllib.error
import urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
DB_ID=os.environ['FMI_DB_UUID']
HEADERS={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],
    'Accept':'application/json',
    'Content-Type':'application/json',
    'User-Agent':'MUSITU-FMI-Customer-Schema-Probe/1.0',
}

def d1(sql,params=None):
    payload={'sql':sql}
    if params is not None: payload['params']=params
    req=urllib.request.Request(
        f'{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query',
        method='POST',headers=HEADERS,data=json.dumps(payload,separators=(',',':')).encode())
    try:
        with urllib.request.urlopen(req,timeout=45) as r:
            raw=r.read(); code=r.status
    except urllib.error.HTTPError as e:
        raw=e.read(); code=e.code
    if code!=200: raise RuntimeError(f'D1 HTTP {code}')
    obj=json.loads(raw or b'{}')
    if obj.get('success') is False: raise RuntimeError('D1 success=false')
    rows=[]
    for item in obj.get('result') or []:
        if item.get('success') is not True: raise RuntimeError('D1 statement failed')
        rows.extend(item.get('results') or [])
    return rows

tables=['customers','api_keys','lifecycle_events','billing_checkout_intents','billing_subscriptions','usage_events']
existing={r.get('name') for r in d1("SELECT name FROM sqlite_master WHERE type='table'")}
out_tables={}
for table in tables:
    if table not in existing:
        out_tables[table]={'present':False,'columns':[],'foreign_keys':[]}
        continue
    cols=d1(f'PRAGMA table_info({table})')
    fks=d1(f'PRAGMA foreign_key_list({table})')
    out_tables[table]={
        'present':True,
        'columns':[{
            'name':c.get('name'),'type':c.get('type'),'notnull':bool(c.get('notnull')),
            'pk':bool(c.get('pk')),'has_default':c.get('dflt_value') is not None
        } for c in cols],
        'foreign_keys':[{
            'from':f.get('from'),'to_table':f.get('table'),'to':f.get('to'),
            'on_update':f.get('on_update'),'on_delete':f.get('on_delete')
        } for f in fks]
    }

out={
  'schema':'musitu.fmi.customer-schema-probe.v1',
  'gate':'FMI_CUSTOMER_SCHEMA_READONLY_PASS',
  'tables':out_tables,
  'mutation_performed':False,
  'row_data_read':False,
  'secret_values_read_or_logged':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
open('fmi-customer-schema-probe.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest()
open('fmi-customer-schema-probe.sha256','w').write(digest+'  fmi-customer-schema-probe.json\n')
print(json.dumps({
  'gate':out['gate'],
  'tables':{k:{'present':v['present'],'columns':[c['name'] for c in v['columns']],
               'foreign_keys':v['foreign_keys']} for k,v in out_tables.items()},
  'mutation_performed':False,'row_data_read':False,'evidence_sha256':digest
},sort_keys=True))
