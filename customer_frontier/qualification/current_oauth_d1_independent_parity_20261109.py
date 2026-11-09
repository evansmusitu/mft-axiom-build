"""Independently observed, read-only 2026-11-09 live production OAuth vs isolated target full-record equality.

The independently initiated observer never attempts /export, /import, DDL,
Worker changes, deletes, Paynow, or OAuth. Private rows are compared only in
runner RAM. It prints/writes only SHA-256 digests, counts and boolean receipts.
"""
import hashlib,json,os,re,sys,time,urllib.request,urllib.error
from pathlib import Path
ACCOUNT_SOURCE='93f395f5121954671f92fffa453d6b61'
SOURCE='504029cc-f9a5-495e-818f-63c6144b4ea4'
ACCOUNT_TARGET='c954f0c842a486d0388c05b19cd21e47'
TARGET='c023a0a0-472a-4178-ad07-02f1d6b2e122'
TARGET_NAME='axiom-dr-clean-restore-20261109'
SRC_SCHEMA_SHA='694014c4d0b6e470518e5f4e70695fee27bbb5ac25095cf462f9451fd95ea116'
CATALOG="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
NAMED=re.compile(r'[A-Za-z0-9_]{1,128}\Z',re.ASCII)
start=time.monotonic()
nrequests=0
class Reject(Exception):pass
class NeverRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kwargs):return None
opener=urllib.request.build_opener(NeverRedirect())
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def sha(v):return hashlib.sha256((v if isinstance(v,bytes) else v.encode('utf8'))).hexdigest()

def transport(account,db,kind,sql=None):
    global nrequests
    if (account,db) not in ((ACCOUNT_SOURCE,SOURCE),(ACCOUNT_TARGET,TARGET)):
        raise Reject('UNKNOWN_RESOURCE')
    token=os.environ.get('CLOUDFLARE_API_TOKEN' if account==ACCOUNT_SOURCE else 'CLOUDFLARE_AXIOM_DR_READ_TOKEN')
    if not token or '\n' in token or '\r' in token:raise Reject('SCOPED_SECRET_UNAVAILABLE')
    if time.monotonic()-start>240 or nrequests>=65:raise Reject('READ_BUDGET_EXCEEDED')
    nrequests+=1
    url='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+db
    if kind=='metadata':
        if sql is not None:raise Reject('INVALID_METADATA_QUERY')
        method='GET';body=None
    elif kind=='query':
        if sql!=CATALOG and sql!='SELECT count(*) AS n FROM pragma_foreign_key_check' and not (isinstance(sql,str) and re.fullmatch(r'SELECT \* FROM "[A-Za-z0-9_]{1,128}"',sql,flags=re.ASCII)):
            raise Reject('SQL_NOT_ALLOWED')
        method='POST';url+='/query'
        body=canonical({'sql':sql,'params':[]}).encode('utf8')
    else:raise Reject('METHOD_NOT_ALLOWED')
    headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'MUSITU-AXIOM-DR-IndependentObserver-20261108'}
    if body:headers['Content-Type']='application/json'
    try:
        request=urllib.request.Request(url,method=method,data=body,headers=headers)
        with opener.open(request,timeout=20) as resp:
            status=resp.status;raw=resp.read(7_000_001)
    except (urllib.error.URLError,OSError,TimeoutError):
        raise Reject('PROVIDER_OBSERVATION_UNAVAILABLE') from None
    if len(raw)>7_000_000 or status!=200:raise Reject('PROVIDER_RESPONSE_INVALID')
    try:data=json.loads(raw)
    except Exception:raise Reject('PROVIDER_JSON_INVALID') from None
    if not isinstance(data,dict) or data.get('success') is not True:
        raise Reject('PROVIDER_RESULT_INVALID')
    if kind=='metadata':return data.get('result')
    xs=data.get('result')
    if not isinstance(xs,list) or len(xs)!=1 or not isinstance(xs[0],dict) or xs[0].get('success') is not True:
        raise Reject('QUERY_ENVELOPE_INVALID')
    meta=xs[0].get('meta')
    if not isinstance(meta,dict) or meta.get('changed_db') is not False or type(meta.get('changes')) is not int or meta['changes']!=0 or type(meta.get('rows_written')) is not int or meta['rows_written']!=0:
        raise Reject('READ_ONLY_NOT_ATTESTED')
    rows=xs[0].get('results')
    if not isinstance(rows,list):raise Reject('READ_QUERY_BODY_INVALID')
    return rows

def compare():
    sm=transport(ACCOUNT_SOURCE,SOURCE,'metadata')
    tm=transport(ACCOUNT_TARGET,TARGET,'metadata')
    if not isinstance(sm,dict) or sm.get('uuid')!=SOURCE or not isinstance(tm,dict) or tm.get('uuid')!=TARGET or tm.get('name')!=TARGET_NAME:
        raise Reject('SOURCE_OR_TARGET_IDENTITY_DRIFT')
    src=transport(ACCOUNT_SOURCE,SOURCE,'query',CATALOG)
    dst=transport(ACCOUNT_TARGET,TARGET,'query',CATALOG)
    if len(src)!=33 or len(dst)<32:
        raise Reject('SOURCE_CATALOG_OBJECT_COUNT_DRIFT')
    if not all(isinstance(r,dict) and set(r)=={'type','name','tbl_name','sql'} for r in src+dst):
        raise Reject('CATALOG_INVALID')
    source_user=[r for r in src if r['name'] not in ('_cf_KV','_cf_METADATA')]
    target_user=[r for r in dst if r['name'] not in ('_cf_KV','_cf_METADATA')]
    if (len(source_user)!=32 or len(target_user)!=32 or
        sha(json.dumps(source_user,sort_keys=True))!=SRC_SCHEMA_SHA or
        sha(canonical(source_user))!=sha(canonical(target_user))):
        raise Reject('SCHEMA_NOT_IDENTICAL')
    tables=[r['name'] for r in source_user if r['type']=='table']
    if len(tables)!=17 or len(set(tables))!=17 or any(not NAMED.fullmatch(x) for x in tables):
        raise Reject('USER_TABLE_SCOPE_DRIFT')
    src_accum=hashlib.sha256();dst_accum=hashlib.sha256()
    totals=[0,0]
    for name in sorted(tables):
        sql='SELECT * FROM "'+name+'"'
        for i,(account,db,accum) in enumerate(((ACCOUNT_SOURCE,SOURCE,src_accum),(ACCOUNT_TARGET,TARGET,dst_accum))):
            rows=transport(account,db,'query',sql)
            if any(not isinstance(row,dict) for row in rows) or len(rows)>5000:
                raise Reject('ROW_QUERY_INVALID')
            totals[i]+=len(rows)
            vals=sorted(canonical(r) for r in rows)
            accum.update(canonical([name,vals]).encode('utf8'))
    if totals!=[4764,4764] or src_accum.digest()!=dst_accum.digest():
        raise Reject('DATA_CONTENT_HASH_MISMATCH')
    for account,db in ((ACCOUNT_SOURCE,SOURCE),(ACCOUNT_TARGET,TARGET)):
        fks=transport(account,db,'query','SELECT count(*) AS n FROM pragma_foreign_key_check')
        if len(fks)!=1 or type(fks[0].get('n')) is not int or fks[0]['n']!=0:
            raise Reject('FOREIGN_KEY_CHECK_FAILED')
    return {'schema':'musitu.axiom.current_oauth_independent_hosted_data_parity_20261109.v1',
        'status':'INDEPENDENT_HOSTED_SCHEMA_AND_DATA_PARITY_PASS',
        'source_database_id':SOURCE,'target_database_id':TARGET,
        'source_catalog_sha256':SRC_SCHEMA_SHA,'restored_user_catalog_sha256':sha(canonical(source_user)),
        'user_tables_equal':17,'user_rows_equal':4764,'user_indexes_equal':15,
        'user_triggers_equal':0,'data_sha256':src_accum.hexdigest(),
        'source_target_data_identical':True,'foreign_key_checks_pass':True,
        'zero_write_reads_confirmed':nrequests-2,'total_provider_requests':nrequests,
        'customer_row_values_persisted':False,'production_oauth_changed':False,
        'destructive_recovery_qualified':False,'independent_custody_qualified':False,
        'release_authority':False}

def main():
    try:out=compare();code=0
    except Reject as e:
        out={'schema':'musitu.axiom.independent_hosted_d1_data_parity.v1','status':'UNQUALIFIED',
             'reason_code':str(e),'source_database_id':SOURCE,'target_database_id':TARGET,
             'production_oauth_changed':False,'destructive_recovery_qualified':False,'release_authority':False}
        code=1
    except Exception:
        out={'schema':'musitu.axiom.independent_hosted_d1_data_parity.v1','status':'UNQUALIFIED',
             'reason_code':'UNKNOWN_PROVIDER_OR_VALIDATOR_ERROR','release_authority':False}
        code=1
    out['total_provider_requests']=nrequests
    p=Path('axiom-independent-hosted-restore-readback-20261108.json')
    p.write_text(canonical(out)+'\n')
    print(canonical(out))
    raise SystemExit(code)
if __name__=='__main__':main()
