"""Read-only fixed-UUID D1 aggregate count comparison; never fetch user rows.

Only a catalog SELECT and one COUNT(*) per authenticated user table are admitted.
The resulting count parity does NOT attest to values, row identity, data recovery,
or the safety of applying a production OAuth migration.
"""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT='93f395f5121954671f92fffa453d6b61'
DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
NAME_SHA='7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36'
CATALOG_SHA='e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1'
CATALOG_SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
OLD_BACKUP_SHA='d8fdb7d06f27d3053799ba70eb2c4c12d2b5570eb9c5cf4724e7216908d0b3b3'
OLD_LOCAL_RESTORE_DATA_SHA='ee0420b70e755247368a3fcd3d294696a94212c3b06ae20839b80d57624e27c5'
MAX_QUERIES=26
MAX_REQUESTS=27
IDENTIFIER=re.compile(r'[A-Za-z0-9_]{1,128}\Z',flags=re.ASCII)
COUNT_SQL=re.compile(r'SELECT count\(\*\) AS n FROM "[A-Za-z0-9_]{1,128}"\Z',flags=re.ASCII)

class ObservationRejected(ValueError):
    pass

def sha(value):
    return hashlib.sha256(value.encode('utf8') if isinstance(value,str) else value).hexdigest()

def canonical(rows):
    return json.dumps([dict(sorted(row.items())) for row in rows],ensure_ascii=True,separators=(',',':'))

class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def _provider_fetch(kind,sql=None):
    token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    if not token or '\n' in token or '\r' in token:
        raise ObservationRejected('PROVIDER_CREDENTIAL_MISSING')
    root='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+DB
    if kind=='metadata' and sql is None:
        uri=root
        body=None
        method='GET'
    elif kind=='query' and isinstance(sql,str) and (sql==CATALOG_SQL or COUNT_SQL.fullmatch(sql)):
        uri=root+'/query'
        body=json.dumps({'sql':sql,'params':[]},separators=(',',':')).encode('utf8')
        method='POST'
    else:
        raise ObservationRejected('UNAUTHORIZED_PROVIDER_REQUEST')
    req=urllib.request.Request(uri,data=body,method=method,headers={
        'Authorization':'Bearer '+token,'Accept':'application/json',
        'User-Agent':'MUSITU-AXIOM-Fixed-D1-Counts-ReadOnly/1.0',
        **({'Content-Type':'application/json'} if method=='POST' else {})})
    try:
        with urllib.request.build_opener(NoRedirects()).open(req,timeout=15) as response:
            if response.status!=200:
                raise ObservationRejected('PROVIDER_STATUS_UNQUALIFIED')
            raw=response.read(2_000_001)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ObservationRejected('PROVIDER_UNAVAILABLE') from None
    if len(raw)>2_000_000:
        raise ObservationRejected('PROVIDER_BODY_TOO_LARGE')
    try:
        data=json.loads(raw)
    except (ValueError,UnicodeError):
        raise ObservationRejected('PROVIDER_JSON_UNQUALIFIED') from None
    if not isinstance(data,dict) or data.get('success') is not True:
        raise ObservationRejected('PROVIDER_REJECTED')
    return data.get('result')


def observe(fetch):
    start=time.monotonic()
    requests=0
    reads=0
    def req(kind,sql=None):
        nonlocal requests,reads
        if time.monotonic()-start>120 or requests>=MAX_REQUESTS:
            raise ObservationRejected('QUERY_BUDGET_EXCEEDED')
        requests+=1
        x=fetch(kind,sql)
        if kind=='metadata':return x
        reads+=1
        if not isinstance(x,list) or len(x)!=1 or x[0].get('success') is not True:
            raise ObservationRejected('QUERY_ENVELOPE_UNQUALIFIED')
        m=x[0].get('meta')
        if not isinstance(m,dict) or m.get('changed_db') is not False or type(m.get('changes')) is not int or m['changes']!=0 or type(m.get('rows_written')) is not int or m['rows_written']!=0:
            raise ObservationRejected('ZERO_WRITE_COUNTERS_UNCONFIRMED')
        rows=x[0].get('results')
        if not isinstance(rows,list):raise ObservationRejected('QUERY_ROWS_UNQUALIFIED')
        return rows

    meta=req('metadata')
    if not isinstance(meta,dict) or meta.get('uuid')!=DB or not isinstance(meta.get('name'),str) or sha(meta['name'])!=NAME_SHA or type(meta.get('file_size')) is not int or not 0<meta['file_size']<=16_777_216:
        raise ObservationRejected('DATABASE_IDENTITY_OR_SIZE_DRIFT')
    catalog=req('query',CATALOG_SQL)
    if len(catalog)!=78 or not all(isinstance(v,dict) and set(v)=={'type','name','tbl_name','sql'} for v in catalog):
        raise ObservationRejected('CATALOG_DRIFT')
    if sha(canonical(catalog))!=CATALOG_SHA:
        raise ObservationRejected('CATALOG_DRIFT')
    kinds={name:sum(row['type']==name for row in catalog) for name in ('table','index','trigger','view')}
    if kinds!={'table':26,'index':13,'trigger':39,'view':0}:
        raise ObservationRejected('CATALOG_TYPES_DRIFT')
    tables=[row['name'] for row in catalog if row['type']=='table' and row['name'] not in ('_cf_KV','_cf_METADATA')]
    if len(tables)!=25 or len(set(tables))!=25 or not any(row['type']=='table' and row['name']=='_cf_KV' for row in catalog):
        raise ObservationRejected('USER_TABLE_SCOPE_DRIFT')
    if any(not isinstance(name,str) or not IDENTIFIER.fullmatch(name) for name in tables):
        raise ObservationRejected('UNSAFE_USER_TABLE_IDENTIFIER')
    totals=[]
    for table in sorted(tables):
        result=req('query','SELECT count(*) AS n FROM "'+table+'"')
        if len(result)!=1 or not isinstance(result[0],dict) or set(result[0])!={'n'} or type(result[0]['n']) is not int or not 0<=result[0]['n']<=25:
            raise ObservationRejected('ROW_COUNT_QUERY_UNQUALIFIED')
        totals.append({'table_name_sha256':sha(table),'rows':result[0]['n']})
    total=sum(v['rows'] for v in totals)
    if total!=25 or reads!=MAX_QUERIES or requests!=MAX_REQUESTS:
        raise ObservationRejected('AGGREGATE_SNAPSHOT_COUNT_DRIFT')
    return {'schema':'musitu.axiom.ccc_live_aggregate_count_parity.v1',
        'status':'AGGREGATE_COUNT_PARITY_ONLY','database_id':DB,
        'source_catalog_sha256':CATALOG_SHA,'source_encrypted_backup_sha256':OLD_BACKUP_SHA,
        'local_snapshot_data_sha256_not_equivalence_proof':OLD_LOCAL_RESTORE_DATA_SHA,
        'user_table_count':len(tables),'user_rows_total':total,
        'table_count_vector_sha256':sha(canonical(sorted(totals,key=lambda x:x['table_name_sha256']))),
        'query_count':reads,'query_zero_writes_confirmed':reads,'provider_query_mutations':0,
        'request_count':requests,'user_row_contents_compared':False,
        'identity_qualified':False,'full_restore_qualified':False,
        'production_oauth_changed':False,'release_authority':False}


def main():
    try:
        receipt=observe(_provider_fetch)
    except ObservationRejected as error:
        receipt={'schema':'musitu.axiom.ccc_live_aggregate_count_parity.v1',
                 'status':'UNQUALIFIED','reason_code':str(error),
                 'database_id':DB,'user_row_contents_compared':False,
                 'full_restore_qualified':False,'production_oauth_changed':False,
                 'release_authority':False}
        code=1
    except Exception:
        receipt={'schema':'musitu.axiom.ccc_live_aggregate_count_parity.v1',
                 'status':'UNQUALIFIED','reason_code':'PROVIDER_OR_VALIDATION_UNKNOWN',
                 'database_id':DB,'full_restore_qualified':False,
                 'production_oauth_changed':False,'release_authority':False}
        code=1
    else:
        code=0
    Path('ccc-live-count-parity-20261108.json').write_text(json.dumps(receipt,indent=2,sort_keys=True)+'\n')
    print(json.dumps(receipt,sort_keys=True))
    raise SystemExit(code)

if __name__=='__main__':main()
