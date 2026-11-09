"""One-shot private AXIOM OAuth D1 recovery from the pinned CURRENT encrypted-backup SQL fingerprint.

THIS IS NOT THE ORIGINAL 8-NOV SNAPSHOT. Original 8-Nov data changed.
Source account/database READ/EXPORT ONLY. Target is one exact new empty D1.
No user rows, plaintext dumps, signed download URLs or credentials are logged/artifacted.
Exactly one import sequence, then exactly one target-only Time Travel restore on confirmed import.
"""
import base64, hashlib, json, os, re, sqlite3, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path

SOURCE_ACCOUNT='93f395f5121954671f92fffa453d6b61'
SOURCE_DB='504029cc-f9a5-495e-818f-63c6144b4ea4'
SOURCE_NAME_SHA='b0d9b8d70e3736276b018cc196c1ba823a15b43921b6493e63d95941ea199ef6'
TARGET_ACCOUNT='c954f0c842a486d0388c05b19cd21e47'
TARGET_DB='c023a0a0-472a-4178-ad07-02f1d6b2e122'
TARGET_NAME='axiom-dr-clean-restore-20261109'
CURRENT_SQL_SHA='DYNAMIC_OWNER_ENCRYPTED_IN_SAME_RUN'
CURRENT_SQL_SIZE=None
ORIGINAL_8NOV_SQL_SHA='c8eb426f629d3ef6d84a88aa5e11603e2d2637b266706288435b710537b3b304'
EXPECTED_CATALOG_OBJECTS=33
CATALOG="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
ROOT='https://api.cloudflare.com/client/v4/accounts/'
SAFE_IDENTIFIER=re.compile(r'[A-Za-z0-9_]{1,128}\Z',re.ASCII)
BOOKMARK=re.compile(r'[a-f0-9-]{20,110}\Z',re.ASCII)
BEGIN=time.monotonic()
REQUESTS=0

class Stop(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None
HTTP=urllib.request.build_opener(NoRedirect())

def sha(value):
    return hashlib.sha256(value if isinstance(value,bytes) else value.encode('utf8')).hexdigest()
def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)

def call(method,url,token=None,body=None,max_size=4_100_000,headers=None):
    global REQUESTS
    REQUESTS+=1
    if REQUESTS>100 or time.monotonic()-BEGIN>330:raise Stop('REQUEST_OR_DEADLINE_LIMIT')
    if token is not None and (not token or any(c in token for c in '\r\n')):raise Stop('TOKEN_INVALID')
    h={'Accept':'application/json','User-Agent':'MUSITU-AXIOM-ONEUSE-ISOLATED-DR-20261109'}
    if token:h['Authorization']='Bearer '+token
    if headers:h.update(headers)
    if isinstance(body,dict):
        body=canonical(body).encode()
        h['Content-Type']='application/json'
    elif body is not None and not isinstance(body,bytes):raise Stop('UNREVIEWED_PAYLOAD')
    req=urllib.request.Request(url,data=body,method=method,headers=h)
    try:
        with HTTP.open(req,timeout=30) as response:
            status=response.status
            raw=response.read(max_size+1)
            etag=response.headers.get('ETag')
    except urllib.error.HTTPError as e:
        raise Stop('PROVIDER_HTTP_'+str(e.code)) from None
    except (urllib.error.URLError,OSError,TimeoutError):
        raise Stop('PROVIDER_TRANSPORT_UNKNOWN_NO_RETRY') from None
    if len(raw)>max_size or status not in (200,201):
        raise Stop('PROVIDER_OVERSIZE_OR_STATUS_REJECTED')
    return raw,etag

def cf(account,db,action,method,token,body=None):
    if (account,db) not in ((SOURCE_ACCOUNT,SOURCE_DB),(TARGET_ACCOUNT,TARGET_DB)):
        raise Stop('CROSS_ACCOUNT_DATABASE_REJECTED')
    rules={
      'meta':('','GET'), 'query':('/query','POST'),'export':('/export','POST'),
      'import':('/import','POST'),'bookmark':('/time_travel/bookmark','GET'),
      'restore':('/time_travel/restore','POST')}
    if action not in rules or (rules[action][1]!=method):
        raise Stop('METHOD_NOT_ALLOWED')
    if account==SOURCE_ACCOUNT and action not in ('meta','query','export'):
        raise Stop('PRODUCTION_MUTATION_PROHIBITED')
    if account==TARGET_ACCOUNT and action not in ('meta','query','export','import','bookmark','restore'):
        raise Stop('TARGET_ACTION_NOT_ALLOWED')
    if action=='query' and not (isinstance(body,dict) and body.get('params')==[] and body.get('sql')==CATALOG):
        raise Stop('UNREVIEWED_SQL_QUERY')
    if action=='export' and not (isinstance(body,dict) and body.get('output_format')=='polling' and
            body.get('dump_options')=={'compatibility':'d1'} and
            set(body).issubset({'output_format','dump_options','current_bookmark'})):
        raise Stop('UNREVIEWED_EXPORT')
    if action=='import' and not (account==TARGET_ACCOUNT and isinstance(body,dict)
         and body.get('action') in ('init','ingest','poll')):
        raise Stop('UNREVIEWED_IMPORT')
    path=rules[action][0]
    if action=='restore':
        if account!=TARGET_ACCOUNT or not isinstance(body,dict) or set(body)!={'bookmark'} or not BOOKMARK.fullmatch(body['bookmark']):
            raise Stop('RESTORE_BOOKMARK_NOT_ADMITTED')
        path+='?bookmark='+urllib.parse.quote(body['bookmark'],safe='')
        body=b''
    url=ROOT+account+'/d1/database/'+db+path
    raw,_=call(method,url,token,body,max_size=750000)
    try:out=json.loads(raw)
    except (ValueError,UnicodeError):raise Stop('INVALID_PROVIDER_JSON') from None
    if not isinstance(out,dict) or out.get('success') is not True:
        raise Stop('PROVIDER_OPERATION_DENIED')
    return out.get('result')

def api_catalog(account,db,token):
    result=cf(account,db,'query','POST',token,{'sql':CATALOG,'params':[]})
    if not isinstance(result,list) or len(result)!=1 or not isinstance(result[0],dict):
        raise Stop('CATALOG_RESPONSE_INVALID')
    x=result[0]; meta=x.get('meta')
    if not (x.get('success') is True and isinstance(meta,dict) and meta.get('changed_db') is False and
           meta.get('changes')==0 and meta.get('rows_written')==0):
        raise Stop('CATALOG_ZERO_WRITES_NOT_ATTESTED')
    rows=x.get('results')
    if not isinstance(rows,list) or any(not isinstance(y,dict) or set(y)!={'type','name','tbl_name','sql'} for y in rows):
        raise Stop('CATALOG_ROWS_INVALID')
    return rows

def validate_exact_names(source_token,target_token):
    src=cf(SOURCE_ACCOUNT,SOURCE_DB,'meta','GET',source_token)
    dst=cf(TARGET_ACCOUNT,TARGET_DB,'meta','GET',target_token)
    if not isinstance(src,dict) or src.get('uuid')!=SOURCE_DB or sha(str(src.get('name','')))!=SOURCE_NAME_SHA:
        raise Stop('SOURCE_IDENTITY_DRIFT')
    if not isinstance(dst,dict) or dst.get('uuid')!=TARGET_DB or dst.get('name')!=TARGET_NAME:
        raise Stop('TARGET_IDENTITY_DRIFT')
    src_catalog=api_catalog(SOURCE_ACCOUNT,SOURCE_DB,source_token)
    target_catalog=api_catalog(TARGET_ACCOUNT,TARGET_DB,target_token)
    if len(src_catalog)!=EXPECTED_CATALOG_OBJECTS:
        raise Stop('SOURCE_CATALOG_OBJECT_COUNT_DRIFT')
    if len(target_catalog)>2 or any(x.get('name') not in ('_cf_KV','_cf_METADATA') or
        x.get('type')!='table' for x in target_catalog):
        raise Stop('TARGET_NOT_EMPTY_OR_FOREIGN_SCHEMA')
    return src_catalog

def validate_signed(url):
    try:p=urllib.parse.urlsplit(url)
    except (ValueError,TypeError):raise Stop('SIGNED_URL_INVALID') from None
    if (p.scheme!='https' or p.username or p.password or p.port or not p.hostname or
        not (p.hostname.endswith('.r2.cloudflarestorage.com') or p.hostname.endswith('.cloudflare.com'))):
        raise Stop('SIGNED_URL_NOT_PROVIDER_OWNED')
    return url

def exported_sql(account,db,token):
    bookmark=None
    for i in range(10):
        request={'output_format':'polling','dump_options':{'compatibility':'d1'}}
        if bookmark is not None:request['current_bookmark']=bookmark
        result=cf(account,db,'export','POST',token,request)
        if not isinstance(result,dict) or result.get('success') is not True or result.get('status')=='error':
            raise Stop('EXPORT_PROVIDER_REJECTED')
        if result.get('status')=='complete':
            url=validate_signed((result.get('result') or {}).get('signed_url'))
            content,_=call('GET',url,None,max_size=4_100_000)
            if not 1000<len(content)<=4_100_000:raise Stop('EXPORT_SIZE_OUT_OF_RANGE')
            return content
        nxt=result.get('at_bookmark')
        if not isinstance(nxt,str) or not nxt or len(nxt)>4096 or (bookmark is not None and bookmark!=nxt):
            raise Stop('EXPORT_BOOKMARK_DRIFT')
        bookmark=nxt
        time.sleep(.25)
    raise Stop('EXPORT_POLL_EXHAUSTED')


def encrypt_to_owner(raw):
    """Use SHA-pinned reviewed Node encryption module; raw SQL only via anonymous stdin pipe.
    No plaintext SQL is ever written to a runner file, stdout, log or artifact.
    """
    if not isinstance(raw,bytes) or not 1_000_000<len(raw)<4_100_000:
        raise Stop('PLAINTEXT_SOURCE_BOUNDS_INVALID')
    root=Path(__file__).resolve().parents[2]
    public=root/'customer_frontier/recovery/recipient-20261106.pem'
    module=root/'customer_frontier/recovery/export_prod_oauth_current_encrypted_20261108.mjs'
    if not public.is_file() or not module.is_file():
        raise Stop('REVIEWED_ENCRYPTOR_OR_PUBLIC_RECIPIENT_MISSING')
    pem=public.read_bytes()
    if sha(pem)!='d97bd50654cd7a02c55d25ebce421e1fc31642f1c4a57d2a24eafe9f5e328fd3':
        raise Stop('OWNER_PUBLIC_RECIPIENT_SHA_MISMATCH')
    hdr={'schema':'musitu.axiom.d1_logical_export.v1','database_id':SOURCE_DB,
        'catalog_sha256':'56c70460aecf66af4eab25d4c7e363efb0a76866f788bcd5ae70f52a0f3e7ee1',
        'recipient_public_sha256':sha(pem),'sql_bytes':len(raw),'sql_sha256':sha(raw),
        'snapshot_semantics':'observed_20261109_current_not_20261108_original'}
    js="""
import {readFileSync} from 'node:fs';
import {createPublicKey} from 'node:crypto';
import {encryptBackup} from './customer_frontier/recovery/export_prod_oauth_current_encrypted_20261108.mjs';
const key=readFileSync('./customer_frontier/recovery/recipient-20261106.pem');
const publicKey=createPublicKey(key);
if(publicKey.asymmetricKeyType!=='rsa'||publicKey.asymmetricKeyDetails?.modulusLength!==4096){
  process.exit(17);
}
const buffers=[];
for await (const data of process.stdin)buffers.push(data);
const clear=Buffer.concat(buffers);
const header=JSON.parse(process.env.AXIOM_SNAPSHOT_HEADER);
const encrypted=encryptBackup(clear,key,header);
clear.fill(0);
process.stdout.write(encrypted);
"""
    try:
        out=subprocess.run(['node','--input-type=module','-e',js],
             input=raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
             cwd=str(root),env={**os.environ,'AXIOM_SNAPSHOT_HEADER':canonical(hdr)},
             timeout=40,check=False)
    except (OSError,subprocess.TimeoutExpired):
        raise Stop('OWNER_ENCRYPTION_PROCESS_UNAVAILABLE') from None
    if out.returncode!=0 or not 1_000_000<len(out.stdout)<7_000_000:
        raise Stop('OWNER_ENCRYPTION_FAILED') 
    try:
        env=json.loads(out.stdout)
        aad=json.loads(base64.b64decode(env.get('aad_b64',''),validate=True))
    except (ValueError,TypeError,UnicodeError):
        raise Stop('OWNER_ENCRYPTED_ENVELOPE_INVALID') from None
    if (env.get('schema')!='musitu.axiom.encrypted_d1_backup.v1' or
        env.get('algorithm')!='RSA-OAEP-SHA256+AES-256-GCM' or
        aad!=hdr or not all(isinstance(env.get(k),str) and env[k] for k in
        ('ciphertext_b64','wrapped_key_b64','nonce_b64','tag_b64'))):
        raise Stop('OWNER_ENCRYPTED_ENVELOPE_PROVENANCE_FAIL')
    return out.stdout

def reorder(sql):
    classes={k:[] for k in ('PRAGMA','TABLE','INDEX','INSERT','TRIGGER')}
    buffer=''
    for line in sql.splitlines(keepends=True):
        buffer+=line
        if sqlite3.complete_statement(buffer):
            item=buffer
            upper=item.lstrip().upper()
            if upper.startswith('PRAGMA DEFER_FOREIGN_KEYS=TRUE;'):kind='PRAGMA'
            elif upper.startswith('CREATE TABLE '):kind='TABLE'
            elif upper.startswith('CREATE INDEX ') or upper.startswith('CREATE UNIQUE INDEX '):kind='INDEX'
            elif upper.startswith('INSERT INTO '):kind='INSERT'
            elif upper.startswith('CREATE TRIGGER '):kind='TRIGGER'
            else:raise Stop('UNKNOWN_SOURCE_DUMP_STATEMENT')
            classes[kind].append(item)
            buffer=''
    if buffer.strip():raise Stop('INCOMPLETE_DUMP_STATEMENT')
    counts={k:len(v) for k,v in classes.items()}
    if not (counts['PRAGMA']==1 and counts['TABLE']==17 and counts['INDEX']==15 and
        counts['TRIGGER']==0 and 4000<=counts['INSERT']<=15000):
        raise Stop('SOURCE_SQL_CLASSES_DRIFT')
    return ('\n'.join(v for k in ('PRAGMA','TABLE','INDEX','INSERT','TRIGGER') for v in classes[k])).encode(),counts

def value_repr(v):
    if v is None:return ['null']
    if isinstance(v,int):return ['i',str(v)]
    if isinstance(v,float):return ['f',v.hex()]
    if isinstance(v,str):return ['t',v]
    if isinstance(v,bytes):return ['b',base64.b64encode(v).decode()]
    raise Stop('UNSUPPORTED_SQLITE_VALUE_TYPE')

def memory_parity(raw):
    db=sqlite3.connect(':memory:')
    try:
        db.execute('PRAGMA foreign_keys=ON')
        sql=raw.decode('utf8')
        db.executescript('BEGIN;\n'+sql+'\nCOMMIT;')
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise Stop('RAM_INTEGRITY_FAIL')
        if list(db.execute('PRAGMA foreign_key_check')):raise Stop('RAM_FK_FAIL')
        objects=db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV','_cf_METADATA') ORDER BY type,name").fetchall()
        tables=[name for typ,name,tbl,sql in objects if typ=='table']
        indexes=[name for typ,name,tbl,sql in objects if typ=='index']
        if len(tables)!=17 or len(indexes)!=15 or any(not SAFE_IDENTIFIER.fullmatch(t) for t in tables):
            raise Stop('RAM_SCHEMA_SCOPE_DRIFT')
        schema_hash=sha(canonical(objects))
        digest=hashlib.sha256()
        total=0
        for name in sorted(tables):
            rows=list(db.execute('SELECT * FROM "'+name+'"'))
            total+=len(rows)
            vals=sorted(sha(canonical([value_repr(v) for v in row])) for row in rows)
            digest.update(canonical([name,vals]).encode())
        if not 4000<=total<=15000:raise Stop('RAM_ROW_BOUNDS_UNEXPECTED')
        return {'schema_sha256':schema_hash,'row_sha256':digest.hexdigest(),'table_count':len(tables),
                'index_count':len(indexes),'total_rows':total,'foreign_key_violations':0,'integrity_ok':True}
    finally:db.close()

def target_bookmark(token):
    b=cf(TARGET_ACCOUNT,TARGET_DB,'bookmark','GET',token)
    mark=b.get('bookmark') if isinstance(b,dict) else None
    if not isinstance(mark,str) or not BOOKMARK.fullmatch(mark) or '--' in mark:
        raise Stop('TIME_TRAVEL_BOOKMARK_INVALID')
    return mark

def restore_import_once(token,source):
    checksum=hashlib.md5(source).hexdigest()
    init=cf(TARGET_ACCOUNT,TARGET_DB,'import','POST',token,{'action':'init','etag':checksum})
    if not isinstance(init,dict):raise Stop('IMPORT_INIT_NOT_ACKNOWLEDGED')
    upload=validate_signed(init.get('upload_url'))
    file=init.get('filename')
    if not isinstance(file,str) or not 1<=len(file)<=256:raise Stop('IMPORT_FILENAME_INVALID')
    _,etag=call('PUT',upload,None,source,max_size=12000)
    if (etag or '').strip('"').lower()!=checksum:raise Stop('UPLOAD_ETAG_MISMATCH_NO_RETRY')
    result=cf(TARGET_ACCOUNT,TARGET_DB,'import','POST',token,
        {'action':'ingest','etag':checksum,'filename':file})
    for n in range(24):
        if (isinstance(result,dict) and result.get('status')=='complete' and
            result.get('success') is True and result.get('type') in ('import',None)):
            return {'import_acknowledged':True,'polls':n}
        if not isinstance(result,dict) or result.get('status')=='error':raise Stop('IMPORT_ERROR_NO_RETRY')
        bookmark=result.get('at_bookmark')
        if not isinstance(bookmark,str) or not bookmark or len(bookmark)>4096:
            raise Stop('IMPORT_BOOKMARK_INVALID_NO_RETRY')
        time.sleep(.35)
        result=cf(TARGET_ACCOUNT,TARGET_DB,'import','POST',token,{'action':'poll','current_bookmark':bookmark})
    raise Stop('IMPORT_POLL_NOT_COMPLETED_NO_RETRY')

def restore_time_travel_once(token,bookmark):
    result=cf(TARGET_ACCOUNT,TARGET_DB,'restore','POST',token,{'bookmark':bookmark})
    if not isinstance(result,dict) or not (BOOKMARK.fullmatch(str(result.get('bookmark',''))) and
        BOOKMARK.fullmatch(str(result.get('previous_bookmark','')))):
        raise Stop('ROLLBACK_RESULT_INVALID_NO_RETRY')
    return True

def run():
    source=os.environ.get('CLOUDFLARE_API_TOKEN','')
    admin=os.environ.get('MUSITU_CLOUDFLARE_ADMIN_TOKEN','')
    reader=os.environ.get('CLOUDFLARE_AXIOM_DR_READ_TOKEN','')
    receipt={'schema':'AXIOM_REAL_OAUTH_FRESH_20261109_ISOLATED_IMPORT_AND_ROLLBACK',
        'source_database_id':SOURCE_DB,'target_database_id':TARGET_DB,
        'original_8nov_sql_differs':True,'source_snapshot_sha256':None,
        'source_expected_sql_bytes':None,'backup_to_owner_encrypted':False,
        'source_production_mutations':0,'new_database_creation_attempts':0,
        'import_attempts':0,'rollback_attempts':0,'customer_values_logged':False,
        'unreviewed_provider_write':False,'customer_payload_in_artifact':False,
        'production_oauth_schema_changed':False,'release_qualified':False,
        'identity_live_qualified':False,'destructive_full_disaster_recovery_qualified':False,
        'status':'STOPPED_BEFORE_IMPORT'}
    imported=False
    mark=None
    try:
        if not source or not admin or not reader or len({source,admin,reader})!=3:
            raise Stop('DISTINCT_THREE_SCOPED_SECRETS_REQUIRED')
        receipt['phase']='PINNED_IDENTITIES'
        validate_exact_names(source,reader)
        raw=exported_sql(SOURCE_ACCOUNT,SOURCE_DB,source)
        # This exact exported SQL is the snapshot restored in this run; production may
        # have changed since its 8-Nov or earlier 9-Nov export. Never substitute it.
        if not 2_000_000<=len(raw)<=4_100_000 or sha(raw)==ORIGINAL_8NOV_SQL_SHA:
            raise Stop('CURRENT_SOURCE_BOUNDS_OR_EXPECTED_DRIFT_INVALID')
        receipt['actual_source_sql_sha256']=sha(raw)
        receipt['actual_source_sql_bytes']=len(raw)
        receipt['phase']='ENCRYPT_THIS_EXACT_SNAPSHOT_TO_OWNER'
        encrypted=encrypt_to_owner(raw)
        receipt['new_envelope_sha256']=sha(encrypted)
        receipt['new_envelope_bytes']=len(encrypted)
        receipt['backup_to_owner_encrypted']=True
        Path('axiom-20261109-exact-import-source.json.enc').write_bytes(encrypted)
        receipt['phase']='RAM_RESTORE_VALIDATION'
        ordered,counts=reorder(raw.decode('utf8'))
        pre=memory_parity(ordered)
        receipt['source_record_count']=pre['total_rows']
        receipt['schema_objects']={'tables':pre['table_count'],'indexes':pre['index_count']}
        receipt['import_sql_sha256']=sha(ordered)
        receipt['expected_row_sha256']=pre['row_sha256']
        receipt['expected_schema_sha256']=pre['schema_sha256']
        raw=None
        mark=target_bookmark(reader)
        receipt['preimport_bookmark_sha256']=sha(mark)
        receipt['phase']='ONE_TARGET_IMPORT_ATTEMPT'
        receipt['import_attempts']=1
        restore_import_once(admin,ordered)
        imported=True
        receipt['phase']='POSTIMPORT_TARGET_SQL_REEXPORTED'
        now=exported_sql(TARGET_ACCOUNT,TARGET_DB,reader)
        after=memory_parity(now)
        receipt['restored_row_sha256']=after['row_sha256']
        receipt['restored_schema_sha256']=after['schema_sha256']
        receipt['source_target_rows_equal']=after['row_sha256']==pre['row_sha256']
        receipt['source_target_schema_equal']=after['schema_sha256']==pre['schema_sha256']
        receipt['target_row_count']=after['total_rows']
        if not (receipt['source_target_rows_equal'] and receipt['source_target_schema_equal'] and
                after['total_rows']==pre['total_rows']):
            raise Stop('PRIVATE_RESTORED_PARITY_FAILED')
        receipt['phase']='TARGET_ONLY_ROLLBACK_ATTEMPT'
        receipt['rollback_attempts']=1
        restore_time_travel_once(admin,mark)
        receipt['phase']='ROLLBACK_EMPTY_READBACK'
        # At most read-only confirmation; independent run must additionally verify.
        catalog=api_catalog(TARGET_ACCOUNT,TARGET_DB,reader)
        if len(catalog)>2 or any(x.get('name') not in ('_cf_KV','_cf_METADATA') for x in catalog):
            raise Stop('ROLLBACK_DID_NOT_RETURN_EMPTY_CATALOG')
        receipt['rollback_original_empty_confirmed']=True
        receipt['status']='FRESH_SNAPSHOT_HOSTED_PARITY_AND_ROLLBACK_PASS_NOT_PRODUCTION_MIGRATION'
    except Stop as e:
        receipt['reason_code']=str(e)
        if imported and receipt['rollback_attempts']==0 and mark and receipt.get('phase')!='ROLLBACK_EMPTY_READBACK':
            try:
                receipt['rollback_attempts']=1
                restore_time_travel_once(admin,mark)
                post=api_catalog(TARGET_ACCOUNT,TARGET_DB,reader)
                receipt['compensating_rollback_empty']=len(post)<=2 and all(x.get('name') in ('_cf_KV','_cf_METADATA') for x in post)
            except Exception:
                receipt['compensating_rollback_empty']=False
                receipt['rollback_unknown_no_retry']=True
        receipt['status']='UNQUALIFIED_OR_FAILED_STOP'
    except Exception as e:
        receipt['reason_type']=type(e).__name__
        receipt['status']='UNKNOWN_NO_RETRY'
    receipt['provider_requests']=REQUESTS
    # On any pre-write failure, a verified encrypted backup may still exist;
    # never use it to infer restoration or rollback qualification.
    receipt['source_snapshot_sha256']=receipt.get('actual_source_sql_sha256')
    receipt['source_expected_sql_bytes']=receipt.get('actual_source_sql_bytes')
    p=Path('axiom-oauth-isolated-restore-rollback-receipt.json')
    output=(canonical(receipt)+'\n').encode()
    p.write_bytes(output)
    Path(str(p)+'.sha256').write_text(sha(output)+'  '+p.name+'\n')
    print('AXIOM_OAUTH_ISOLATED_RECOVERY='+receipt['status']+' IMPORT='+str(receipt['import_attempts'])+' ROLLBACK='+str(receipt['rollback_attempts']))
    return 0 if receipt['status']=='FRESH_SNAPSHOT_HOSTED_PARITY_AND_ROLLBACK_PASS_NOT_PRODUCTION_MIGRATION' else 2

if __name__=='__main__':sys.exit(run())
