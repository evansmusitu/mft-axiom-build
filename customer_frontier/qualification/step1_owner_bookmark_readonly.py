#!/usr/bin/env python3
"""Read-only source D1 Time Travel bookmark observation; NO RESTORE/EXPORT.

Only authenticates exact pinned original D1 over two GET requests. A bookmark
hash is evidence of a provider read, not SQL snapshot parity or backup custody.
No raw bookmark, customer data, token or provider response is persisted.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
SOURCE = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
BASE = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{SOURCE}'
OUTPUT = 'axiom_step1_owner_bookmark_readonly_20261112.json'
SCHEMA = 'musitu.axiom.step1.owner-source-bookmark-get-only.v1'

class NoGo(Exception):
    pass

class BlockRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def _untrusted_json_doc(raw: bytes):
    if len(raw) > 100_000:
        raise NoGo('OVERSIZE_RESPONSE')
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, ValueError) as exc:
        raise NoGo('INVALID_RESPONSE_JSON') from exc

def validate_source_detail(doc):
    if not isinstance(doc,dict) or doc.get('success') is not True:
        raise NoGo('SOURCE_DETAIL_NOT_AUTHENTICATED')
    data=doc.get('result')
    if not isinstance(data,dict) or data.get('uuid')!=SOURCE:
        raise NoGo('SOURCE_DETAIL_UUID_MISMATCH')
    if not isinstance(data.get('name'),str) or not data['name'] or len(data['name'])>255:
        raise NoGo('SOURCE_NAME_UNQUALIFIED')
    return hashlib.sha256(data['name'].encode()).hexdigest()

def validate_bookmark(doc):
    if not isinstance(doc,dict) or doc.get('success') is not True:
        raise NoGo('BOOKMARK_RESPONSE_NOT_SUCCESS')
    data=doc.get('result')
    if not isinstance(data,dict):
        raise NoGo('BOOKMARK_RESULT_MISSING')
    bookmark=data.get('bookmark')
    # Opaque provider marker; reject empty, secrets-injection, control chars, data strings.
    if not isinstance(bookmark,str) or not 16 <= len(bookmark) <= 256 or not re.fullmatch(r'[A-Za-z0-9-]+',bookmark):
        raise NoGo('BOOKMARK_FORMAT_UNQUALIFIED')
    return hashlib.sha256(bookmark.encode('ascii')).hexdigest()

def get_doc(url, token):
    if url not in {BASE, BASE+'/time_travel/bookmark'}:
        raise NoGo('UNREVIEWED_URL')
    if not isinstance(token,str) or not 8<=len(token)<=4096 or any(c in token for c in '\r\n'):
        raise NoGo('TOKEN_UNAVAILABLE')
    req=urllib.request.Request(url, method='GET', headers={'Authorization':'Bearer '+token, 'Accept':'application/json'})
    try:
        with urllib.request.build_opener(BlockRedirect()).open(req, timeout=16) as res:
            if res.status!=200:raise NoGo('HTTP_UNEXPECTED_STATUS')
            raw=res.read(100_001)
            return _untrusted_json_doc(raw)
    except urllib.error.HTTPError as e:
        raise NoGo('HTTP_'+str(e.code)) from None
    except (OSError, TimeoutError) as e:
        raise NoGo('PROVIDER_UNAVAILABLE') from None

def receipt_for(source_response, bookmark_response, captured_at):
    r={'schema':SCHEMA,'source_account':ACCOUNT,'source_database':SOURCE,
       'captured_at_utc':captured_at,'http_methods':['GET','GET'],
       'database_mutations':0,'sql_queries':0,'customer_rows_collected':0,
       'bookmark_raw_persisted':False,'real_sql_backup_qualified':False,
       'hosted_restore_qualified':False,'zero_additional_spend_qualified':False,
       'owner_key_custody_qualified':False,'step_1_closed':False,
       'step_2_authorized':False,'release':'NOT_RELEASE',
       'status':'SOURCE_BOOKMARK_UNQUALIFIED_NO_GO'}
    try:
        r['source_name_sha256']=validate_source_detail(source_response)
        r['bookmark_sha256']=validate_bookmark(bookmark_response)
        r['source_detail_matched']=True
        r['status']='SOURCE_BOOKMARK_HASH_OBSERVED_NOT_BACKUP_NO_GO'
    except NoGo as exc:
        r['sanitized_error_code']=str(exc)
        r['source_detail_matched']=False
    return r

def write_receipt(r, folder: Path=Path('.')):
    data=(json.dumps(r, sort_keys=True, indent=2)+'\n').encode()
    (folder/OUTPUT).write_bytes(data)
    (folder/(OUTPUT+'.sha256')).write_text(hashlib.sha256(data).hexdigest()+'  '+OUTPUT+'\n')

def main():
    token=os.getenv('CLOUDFLARE_API_TOKEN','')
    captured=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
    try:
        src=get_doc(BASE,token)
        bkm=get_doc(BASE+'/time_travel/bookmark',token)
        r=receipt_for(src,bkm,captured)
    except NoGo as exc:
        r=receipt_for(None,None,captured)
        r['sanitized_error_code']=str(exc)
    write_receipt(r)
    print('AXIOM_STEP1_BOOKMARK_READONLY_'+r['status'])
    return 0  # NO_GO is a safe observation, not CI failure or permission to proceed.

if __name__ == '__main__':
    raise SystemExit(main())
