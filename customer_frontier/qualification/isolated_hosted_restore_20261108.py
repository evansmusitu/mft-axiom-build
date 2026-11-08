"""One-shot Cloudflare D1 disaster-recovery rehearsal into exactly one isolated empty database.

Never logs, persists, or artifacts original customer SQL, records, or provider URLs.
Source SQL must have identical SHA256 and size to the independently owner-encrypted
2026-11-08 backup. Only target is writable. NEVER RETRY uncertain import.
"""
import hashlib, json, os, re, sqlite3, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

SOURCE_ACCOUNT='93f395f5121954671f92fffa453d6b61'
SOURCE_DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
SOURCE_NAME_SHA='7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36'
CATALOG_SHA='e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1'
TARGET_ACCOUNT='c954f0c842a486d0388c05b19cd21e47'
TARGET_DB='e36972b3-850d-4273-b934-2fa67587d9f1'
TARGET_NAME='axiom-disposable-dr-target-20261108'
ARCHIVED_SQL_SHA='1daa973a46c012f9c61b36814bf339fe93ae374e418b7938bb86c36f1dcde627'
ARCHIVED_SQL_SIZE=28985
REORDERED_SQL_SHA='84fc058d1ae5986b15c996449827b05af962ad0483f47a3b14655be9a90c1d53'
SOURCE_BACKUP_ENVELOPE_SHA='d8fdb7d06f27d3053799ba70eb2c4c12d2b5570eb9c5cf4724e7216908d0b3b3'
CATALOG_SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
REQUIRED_STATEMENT_COUNTS={'PRAGMA':1,'TABLE':25,'INDEX':13,'INSERT':25,'TRIGGER':39}
IDENTIFIER=re.compile(r'[A-Za-z0-9_]{1,128}\Z',re.ASCII)
READ_BUDGET=95
class Rejected(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k):return None
OPENER=urllib.request.build_opener(NoRedirect())
start=time.monotonic()
reads=0
writes=0

def sha(data):
    if isinstance(data,str):data=data.encode('utf8')
    return hashlib.sha256(data).hexdigest()
def canonical(obj):
    return json.dumps(obj,sort_keys=True,separators=(',',':'),ensure_ascii=True)

def request(method,uri,token=None,body=None,allowed_prefix=None,max_size=2_000_000):
    global reads,writes
    if time.monotonic()-start>330:raise Rejected('TOTAL_DEADLINE_EXCEEDED')
    if allowed_prefix is not None and not uri.startswith(allowed_prefix):
        raise Rejected('UNAUTHORIZED_API_PATH')
    if method not in ('GET','POST','PUT'):raise Rejected('UNAUTHORIZED_METHOD')
    if method=='GET':reads+=1
    else:writes+=1
    if reads+writes>READ_BUDGET:raise Rejected('REQUEST_BUDGET_EXCEEDED')
    if token is not None and (not token or '\r' in token or '\n' in token):
        raise Rejected('CREDENTIAL_MISSING')
    headers={'Accept':'application/json','User-Agent':'MUSITU-AXIOM-PrivateD1RecoveryRehearsal-20261108'}
    if token:headers['Authorization']='Bearer '+token
    if isinstance(body,dict):
        body=canonical(body).encode('utf8')
        headers['Content-Type']='application/json'
    req=urllib.request.Request(uri,data=body,method=method,headers=headers)
    try:
        with OPENER.open(req,timeout=30) as resp:
            status=resp.status
            raw=resp.read(max_size+1)
            etag=resp.headers.get('ETag')
    except urllib.error.HTTPError as e:
        raise Rejected('PROVIDER_HTTP_'+str(e.code)) from None
    except (urllib.error.URLError,OSError,TimeoutError):
        raise Rejected('PROVIDER_NETWORK_UNKNOWN_NO_RETRY') from None
    if len(raw)>max_size or status not in (200,201):
        raise Rejected('PROVIDER_HTTP_OR_RESPONSE_SIZE_UNQUALIFIED')
    return status,raw,etag

def endpoint(account,db,suffix=''):
    if (account,db) not in ((SOURCE_ACCOUNT,SOURCE_DB),(TARGET_ACCOUNT,TARGET_DB)):
        raise Rejected('CROSS_ACCOUNT_RESOURCE_NOT_ALLOWED')
    if suffix not in ('','/query','/export','/import'):
        raise Rejected('API_SUFFIX_NOT_ALLOWED')
    return 'https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+db+suffix

def cf(account,db,suffix,method,token,body=None):
    # The sole permitted mutation is target /import; source may POST /export
    if account==SOURCE_ACCOUNT and suffix not in ('','/query','/export'):
        raise Rejected('SOURCE_MUTATION_FORBIDDEN')
    if account==TARGET_ACCOUNT and suffix not in ('','/query','/import'):
        raise Rejected('TARGET_PATH_FORBIDDEN')
    if suffix=='' and method!='GET':raise Rejected('DATABASE_METADATA_READ_ONLY')
    if suffix=='/query' and (method!='POST' or body is None or body.get('params')!=[]):
        raise Rejected('QUERY_CONTRACT_INVALID')
    if suffix=='/import' and (account!=TARGET_ACCOUNT or method!='POST' or body.get('action') not in ('init','ingest','poll')):
        raise Rejected('IMPORT_CONTRACT_INVALID')
    if suffix=='/export' and (account!=SOURCE_ACCOUNT or method!='POST'):
        raise Rejected('EXPORT_CONTRACT_INVALID')
    url=endpoint(account,db,suffix)
    status,raw,_=request(method,url,token,body,allowed_prefix=url,max_size=2_000_000)
    try:data=json.loads(raw)
    except (UnicodeError,ValueError):raise Rejected('INVALID_PROVIDER_JSON') from None
    if not isinstance(data,dict) or data.get('success') is not True:
        raise Rejected('PROVIDER_OPERATION_REJECTED')
    return data.get('result')

def sql_query(account,db,token,sql,allow_rows=False):
    if sql!=CATALOG_SQL and sql!='SELECT count(*) AS n FROM pragma_foreign_key_check' and not (allow_rows and re.fullmatch(r'SELECT \* FROM "[A-Za-z0-9_]{1,128}"',sql,flags=re.ASCII)):
        raise Rejected('UNADMITTED_SQL')
    result=cf(account,db,'/query','POST',token,{'sql':sql,'params':[]})
    if not isinstance(result,list) or len(result)!=1 or not isinstance(result[0],dict) or result[0].get('success') is not True:
        raise Rejected('QUERY_RESULT_UNQUALIFIED')
    m=result[0].get('meta')
    if not isinstance(m,dict) or m.get('changed_db') is not False or type(m.get('changes')) is not int or m['changes']!=0 or type(m.get('rows_written')) is not int or m['rows_written']!=0:
        raise Rejected('QUERY_ZERO_WRITE_UNCONFIRMED')
    rows=result[0].get('results')
    if not isinstance(rows,list):raise Rejected('QUERY_ROWS_INVALID')
    return rows

def catalog(account,db,token):
    rows=sql_query(account,db,token,CATALOG_SQL)
    if any(not isinstance(row,dict) or set(row)!={'type','name','tbl_name','sql'} for row in rows):
        raise Rejected('CATALOG_INVALID')
    return rows

def checked_source_catalog(rows):
    if len(rows)!=78 or sha(canonical(rows))!=CATALOG_SHA:
        raise Rejected('SOURCE_CATALOG_DRIFT')
    return True

def checked_target_empty(rows):
    # Brand new Cloudflare D1 includes one or more managed-only tables.
    for r in rows:
        if r['type']!='table' or r['name'] not in ('_cf_KV','_cf_METADATA'):
            raise Rejected('TARGET_NOT_EMPTY_OR_FOREIGN_SCHEMA')
    if len(rows)>2:raise Rejected('TARGET_SYSTEM_OBJECTS_DRIFT')
    return True

def split_sql(sql):
    statements=[];buf=''
    if not isinstance(sql,str) or len(sql)>1_000_000:raise Rejected('SOURCE_SQL_TOO_LARGE')
    for line in sql.splitlines(keepends=True):
        buf+=line
        if sqlite3.complete_statement(buf):
            statements.append(buf);buf=''
    if buf.strip():raise Rejected('INCOMPLETE_SQL_STATEMENT')
    return statements

def reorder_sql(sql,strict=True):
    classes={'PRAGMA':[],'TABLE':[],'INDEX':[],'INSERT':[],'TRIGGER':[]}
    for statement in split_sql(sql):
        line=statement.lstrip().upper()
        if line.startswith('PRAGMA DEFER_FOREIGN_KEYS=TRUE;'):
            kind='PRAGMA'
        elif line.startswith('CREATE TABLE '):kind='TABLE'
        elif line.startswith('CREATE UNIQUE INDEX ') or line.startswith('CREATE INDEX '):kind='INDEX'
        elif line.startswith('INSERT INTO '):kind='INSERT'
        elif line.startswith('CREATE TRIGGER '):kind='TRIGGER'
        else:raise Rejected('UNKNOWN_DUMP_SQL_STATEMENT')
        classes[kind].append(statement)
    if strict and {k:len(v) for k,v in classes.items()}!=REQUIRED_STATEMENT_COUNTS:
        raise Rejected('SQL_STATEMENT_CLASSES_OR_COUNTS_DRIFT')
    ordered='\n'.join(x for kind in ('PRAGMA','TABLE','INDEX','INSERT','TRIGGER') for x in classes[kind])
    if strict and sha(ordered)!=REORDERED_SQL_SHA:
        raise Rejected('AUTHENTICATED_REORDERED_SQL_DRIFT')
    return ordered,classes

def offline_fkreplay(ordered,expected_tables=25,expected_rows=25):
    # RAM only; a failure stops BEFORE any target import.
    db=sqlite3.connect(':memory:')
    try:
        db.execute('PRAGMA foreign_keys=ON')
        db.executescript('BEGIN;\n'+ordered+'\nCOMMIT;')
        if db.execute('PRAGMA foreign_keys').fetchone()[0]!=1:raise Rejected('OFFLINE_FK_NOT_ENFORCED')
        if db.execute('PRAGMA foreign_key_check').fetchall():raise Rejected('OFFLINE_FK_VIOLATIONS')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise Rejected('OFFLINE_INTEGRITY_FAIL')
        tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'")]
        if len(tables)!=expected_tables:raise Rejected('OFFLINE_TABLE_COUNT_MISMATCH')
        if any(not IDENTIFIER.fullmatch(t) for t in tables):raise Rejected('UNSAFE_TABLE_IDENTIFIER')
        total=sum(db.execute('SELECT count(*) FROM "'+t+'"').fetchone()[0] for t in tables)
        if total!=expected_rows:raise Rejected('OFFLINE_ROW_COUNT_MISMATCH')
        return {'tables':len(tables),'rows':total,'foreign_key_violations':0,'integrity':'ok','foreign_keys_on':True}
    finally:db.close()

def source_export(token):
    bookmark=None
    for step in range(12):
        body={'output_format':'polling','dump_options':{'compatibility':'d1'}}
        if bookmark is not None:body['current_bookmark']=bookmark
        result=cf(SOURCE_ACCOUNT,SOURCE_DB,'/export','POST',token,body)
        if not isinstance(result,dict) or result.get('success') is not True or result.get('status')=='error':
            raise Rejected('SOURCE_EXPORT_NOT_SUCCESSFUL')
        if result.get('status')=='complete':
            signed=(result.get('result') or {}).get('signed_url')
            if not isinstance(signed,str):raise Rejected('EXPORT_SIGNED_URL_MISSING')
            uri=urllib.parse.urlsplit(signed)
            if uri.scheme!='https' or uri.username or uri.password or uri.port or not (uri.hostname and (uri.hostname.endswith('.r2.cloudflarestorage.com') or uri.hostname.endswith('.cloudflare.com'))):
                raise Rejected('EXPORT_SIGNED_HOST_NOT_ADMITTED')
            _,raw,_=request('GET',signed,None,None,allowed_prefix='https://',max_size=100_000)
            if len(raw)!=ARCHIVED_SQL_SIZE or sha(raw)!=ARCHIVED_SQL_SHA:
                raise Rejected('ARCHIVED_SNAPSHOT_SOURCE_SQL_CHANGED_NO_IMPORT')
            return raw
        next_bookmark=result.get('at_bookmark')
        if not isinstance(next_bookmark,str) or not next_bookmark or len(next_bookmark)>4096:
            raise Rejected('EXPORT_BOOKMARK_INVALID')
        if bookmark is not None and next_bookmark!=bookmark:
            raise Rejected('EXPORT_BOOKMARK_DRIFT')
        bookmark=next_bookmark
        time.sleep(0.3)
    raise Rejected('SOURCE_EXPORT_NOT_FINISHED')

def safe_import(target_token,sql_bytes):
    # Every import call may have effects; no automatic retries of init, upload, ingest or poll on uncertain status.
    etag=hashlib.md5(sql_bytes).hexdigest()
    init=cf(TARGET_ACCOUNT,TARGET_DB,'/import','POST',target_token,{'action':'init','etag':etag})
    if not isinstance(init,dict):raise Rejected('IMPORT_INIT_UNQUALIFIED_NO_RETRY')
    url=init.get('upload_url');filename=init.get('filename')
    if not isinstance(url,str) or not isinstance(filename,str) or not (1<=len(filename)<=256):
        raise Rejected('IMPORT_INIT_SIGNED_FIELDS_INVALID_NO_RETRY')
    uri=urllib.parse.urlsplit(url)
    if uri.scheme!='https' or uri.username or uri.password or uri.port or not (uri.hostname and (uri.hostname.endswith('.r2.cloudflarestorage.com') or uri.hostname.endswith('.cloudflare.com'))):
        raise Rejected('IMPORT_UPLOAD_HOST_UNQUALIFIED_NO_RETRY')
    _,_,observed_etag=request('PUT',url,None,sql_bytes,allowed_prefix='https://',max_size=5000)
    if (observed_etag or '').strip('"').lower()!=etag:
        raise Rejected('IMPORT_UPLOAD_ETAG_MISMATCH_NO_RETRY')
    ingest=cf(TARGET_ACCOUNT,TARGET_DB,'/import','POST',target_token,{'action':'ingest','etag':etag,'filename':filename})
    if not isinstance(ingest,dict) or ingest.get('status')=='error':
        raise Rejected('IMPORT_INGEST_NOT_ACCEPTED_NO_RETRY')
    result=ingest
    for attempt in range(24):
        if result.get('status')=='complete' and result.get('success') is True and result.get('type') in ('import',None):
            return {'import_confirmed':True,'rounds':attempt}
        if result.get('status')=='error':raise Rejected('IMPORT_REPORTED_ERROR_NO_RETRY')
        bookmark=result.get('at_bookmark')
        if not isinstance(bookmark,str) or not bookmark or len(bookmark)>4096:
            raise Rejected('IMPORT_POLL_BOOKMARK_INVALID_NO_RETRY')
        time.sleep(.35)
        result=cf(TARGET_ACCOUNT,TARGET_DB,'/import','POST',target_token,{'action':'poll','current_bookmark':bookmark})
        if not isinstance(result,dict):raise Rejected('IMPORT_POLL_INVALID_NO_RETRY')
    raise Rejected('IMPORT_NOT_TERMINAL_NO_RETRY')

def read_data_hash(account,db,token,expected_tables):
    catalog_rows=catalog(account,db,token)
    user_tables=[r['name'] for r in catalog_rows if r['type']=='table' and r['name'] not in ('_cf_KV','_cf_METADATA')]
    if len(user_tables)!=25 or set(user_tables)!=set(expected_tables):
        raise Rejected('USER_TABLE_SET_DIFFERS')
    accum=hashlib.sha256()
    total=0
    for name in sorted(user_tables):
        if not IDENTIFIER.fullmatch(name):raise Rejected('UNSAFE_USER_TABLE_NAME')
        rows=sql_query(account,db,token,'SELECT * FROM "'+name+'"',allow_rows=True)
        # Canonical, stable sort independent of remote row iteration.
        vals=sorted(canonical(r) for r in rows)
        accum.update(canonical([name,vals]).encode('utf8'))
        total+=len(rows)
    if total!=25:raise Rejected('LIVE_ROW_TOTAL_MISMATCH')
    fk=sql_query(account,db,token,'SELECT count(*) AS n FROM pragma_foreign_key_check')
    if len(fk)!=1 or type(fk[0].get('n')) is not int or fk[0]['n']!=0:
        raise Rejected('LIVE_FOREIGN_KEY_CHECK_FAIL')
    return {'catalog':catalog_rows,'total':total,'digest':accum.hexdigest()}

def run():
    global reads,writes
    receipt={'schema':'musitu.axiom.isolated_hosted_d1_restore.v1','target_account_id':TARGET_ACCOUNT,
             'target_database_id':TARGET_DB,'source_database_id':SOURCE_DB,
             'status':'UNQUALIFIED','phase':'NOT_STARTED','original_envelope_sha256':SOURCE_BACKUP_ENVELOPE_SHA,
             'archived_plain_sql_sha256':ARCHIVED_SQL_SHA,'source_catalog_sha256':CATALOG_SHA,
             'source_fingerprint_equal_to_target':False,'full_hosted_restore_qualified':False,
             'customer_row_values_logged':False,'customer_data_artifact_created':False,
             'production_oauth_changed':False,'release_authority':False}
    try:
        source_token=os.environ.get('CLOUDFLARE_API_TOKEN','')
        target_token=os.environ.get('AXIOM_CUSTOMER_STAGING_CF_API_TOKEN','')
        if not source_token or not target_token or source_token==target_token:
            raise Rejected('TWO_DISTINCT_SCOPED_TOKENS_REQUIRED')
        receipt['phase']='READ_ONLY_IDENTITIES'
        src=cf(SOURCE_ACCOUNT,SOURCE_DB,'','GET',source_token)
        dst=cf(TARGET_ACCOUNT,TARGET_DB,'','GET',target_token)
        if not isinstance(src,dict) or src.get('uuid')!=SOURCE_DB or sha(str(src.get('name','')))!=SOURCE_NAME_SHA:
            raise Rejected('SOURCE_IDENTITY_MISMATCH')
        if not isinstance(dst,dict) or dst.get('uuid')!=TARGET_DB or dst.get('name')!=TARGET_NAME:
            raise Rejected('TARGET_IDENTITY_MISMATCH')
        source_catalog=catalog(SOURCE_ACCOUNT,SOURCE_DB,source_token)
        checked_source_catalog(source_catalog)
        checked_target_empty(catalog(TARGET_ACCOUNT,TARGET_DB,target_token))
        receipt['phase']='SNAPSHOT_BYTES_VERIFIED'
        plain=source_export(source_token)
        order,classes=reorder_sql(plain.decode('utf8'))
        receipt['offline']=offline_fkreplay(order)
        user_tables=[r['name'] for r in source_catalog if r['type']=='table' and r['name'] not in ('_cf_KV','_cf_METADATA')]
        if len(user_tables)!=25:raise Rejected('SOURCE_USER_TABLE_COUNT_DRIFT')
        # In-memory trusted raw source data; compare after import without logging values.
        receipt['phase']='ISOLATED_TARGET_IMPORT_ATTEMPTED'
        import_result=safe_import(target_token,order.encode('utf8'))
        receipt['import_result']=import_result
        receipt['phase']='HOSTED_IMPORT_COMPLETED_VERIFYING'
        target_catalog=catalog(TARGET_ACCOUNT,TARGET_DB,target_token)
        source_user=[r for r in source_catalog if r['name'] not in ('_cf_KV','_cf_METADATA')]
        target_user=[r for r in target_catalog if r['name'] not in ('_cf_KV','_cf_METADATA')]
        if len(source_user)!=77 or len(target_user)!=77 or sha(canonical(source_user))!=sha(canonical(target_user)):
            raise Rejected('RESTORED_SCHEMA_NOT_IDENTICAL')
        a=read_data_hash(SOURCE_ACCOUNT,SOURCE_DB,source_token,user_tables)
        b=read_data_hash(TARGET_ACCOUNT,TARGET_DB,target_token,user_tables)
        if a['digest']!=b['digest'] or a['total']!=b['total']:
            raise Rejected('RESTORED_PRIVATE_ROW_FINGERPRINT_MISMATCH')
        receipt.update({'status':'HOSTED_RESTORE_SCHEMA_AND_ROWS_MATCH',
            'phase':'HOSTED_RESTORE_CONFIRMED','restored_user_tables':25,'restored_rows':25,
            'restored_indexes':13,'restored_triggers':39,'source_fingerprint_equal_to_target':True,
            'hosted_schema_equality_verified':True,'hosted_foreign_keys_verified':True,
            'snapshot_sql_identical_to_encrypted_archive':True,
            'full_hosted_restore_qualified':False,
            'read_operations':reads,'other_requests_including_source_export_and_target_import':writes})
        # Full DR requires independent post-job verifier and destructive rollback acceptance.
        code=0
    except Rejected as e:
        receipt['reason_code']=str(e)
        code=1
    except Exception:
        receipt['reason_code']='UNKNOWN_OR_PROVIDER_FAILURE_NO_IMPORT_RETRY'
        code=1
    receipt['read_operations']=reads
    receipt['non_get_operations']=writes
    Path('axiom-isolated-hosted-restore-receipt-20261108.json').write_text(canonical(receipt)+'\n')
    print(canonical(receipt))
    return code
if __name__=='__main__':sys.exit(run())
