"""Create one *empty* owner-nominated alternate D1 recovery target, never data restore.

Account ID provided by owner, distinct from original staging account.
Strict GET zero-count -> one POST -> GET verified one-count protocol.
No SQL, no customer export, no production OAuth, no payments, no deletion.
"""
import json, os, re, sys, urllib.request, urllib.error
from pathlib import Path
ACCOUNT='c954f0c842a486d0388c05b19cd21e47'
ORIGINAL_ACCOUNT='93f395f5121954671f92fffa453d6b61'
NAME='axiom-disposable-dr-target-20261108'
BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database'
UUID=re.compile(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\Z')
assert ACCOUNT!=ORIGINAL_ACCOUNT

class Rejected(Exception):
    pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw): return None

def parse_list(data):
    if type(data) is not dict or data.get('success') is not True:
        raise Rejected('D1_LIST_REJECTED')
    result=data.get('result')
    info=data.get('result_info')
    if type(result) is not list or type(info) is not dict or type(info.get('total_count')) is not int or type(info.get('count')) is not int or info['total_count']<0 or info['count']!=len(result):
        raise Rejected('D1_LIST_MALFORMED')
    if info['total_count'] != len(result): # zero/one expected, no pagination
        raise Rejected('D1_LIST_PAGINATION_OR_DRIFT')
    for item in result:
        if type(item) is not dict or not UUID.fullmatch(str(item.get('uuid',''))) or not isinstance(item.get('name'),str):
            raise Rejected('D1_LIST_RESULT_MALFORMED')
    return result

def qualify(fetch):
    writes=0
    before=parse_list(fetch('list'))
    if before:raise Rejected('TARGET_ACCOUNT_NOT_EMPTY')
    # Only write operation in the protocol. Never retry POST on unknown outcome.
    writes+=1
    try:
        response=fetch('create')
    except Rejected:
        raise
    except Exception:
        raise Rejected('CREATE_OUTCOME_UNKNOWN_NO_RETRY') from None
    if type(response) is not dict or response.get('success') is not True:
        raise Rejected('CREATE_REJECTED_NO_RETRY')
    item=response.get('result')
    if type(item) is not dict or item.get('name')!=NAME or not UUID.fullmatch(str(item.get('uuid',''))):
        raise Rejected('CREATED_IDENTITY_UNKNOWN_NO_RETRY')
    after=parse_list(fetch('list'))
    if len(after)!=1 or after[0]['uuid']!=item['uuid'] or after[0]['name']!=NAME:
        raise Rejected('POST_CREATE_D1_LIST_DRIFT')
    return {'schema':'musitu.axiom.disposable_d1_target_create.v1',
        'status':'ONE_EMPTY_DISPOSABLE_TARGET_CREATED_AND_LIST_VERIFIED',
        'account_id':ACCOUNT,'database_id':item['uuid'],'database_name':NAME,
        'existing_databases_before':0,'databases_after':1,'write_operations':writes,
        'source_database_touched':False,'customer_data_imported':False,
        'production_oauth_changed':False,'full_restore_qualified':False,
        'release_authority':False}

def request(kind):
    token=os.environ.get('AXIOM_CUSTOMER_STAGING_CF_API_TOKEN','')
    if not token or '\r' in token or '\n' in token:
        raise Rejected('STAGING_SECRET_MISSING')
    if kind=='list':
        url=BASE+'?page=1&per_page=100'
        method='GET'
        body=None
    elif kind=='create':
        url=BASE
        method='POST'
        body=json.dumps({'name':NAME},separators=(',',':')).encode('utf8')
    else:raise Rejected('REQUEST_NOT_ALLOWED')
    headers={'Authorization':'Bearer '+token,'Accept':'application/json',
             'User-Agent':'MUSITU-AXIOM-IsolatedTargetCreate-20261108',
             **({'Content-Type':'application/json'} if method=='POST' else {})}
    req=urllib.request.Request(url,method=method,data=body,headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=20) as res:
            status=res.status
            raw=res.read(128_001)
    except urllib.error.HTTPError as error:
        if kind=='create' and error.code==403:raise Rejected('CREATE_FORBIDDEN_WRITE_SCOPE')
        raise Rejected(('LIST' if kind=='list' else 'CREATE')+'_HTTP_NOT_ACCEPTED_'+str(error.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise Rejected(('LIST' if kind=='list' else 'CREATE')+'_NETWORK_UNKNOWN_NO_RETRY') from None
    if status not in (200,201) or len(raw)>128_000:
        raise Rejected(('LIST' if kind=='list' else 'CREATE')+'_BAD_STATUS_OR_RESPONSE_SIZE')
    try:return json.loads(raw)
    except (ValueError,UnicodeError):raise Rejected('PROVIDER_BAD_JSON') from None

def main():
    try:
        data=qualify(request)
        code=0
    except Rejected as error:
        data={'schema':'musitu.axiom.disposable_d1_target_create.v1','status':'UNQUALIFIED',
              'reason_code':str(error),'account_id':ACCOUNT,'production_oauth_changed':False,
              'full_restore_qualified':False,'release_authority':False}
        code=1
    except Exception:
        data={'schema':'musitu.axiom.disposable_d1_target_create.v1','status':'UNQUALIFIED',
              'reason_code':'UNKNOWN_FAILURE_NO_RETRY','account_id':ACCOUNT,
              'production_oauth_changed':False,'full_restore_qualified':False,
              'release_authority':False}
        code=1
    Path('disposable-d1-target-create-20261108.json').write_text(json.dumps(data,sort_keys=True,indent=2)+'\n')
    print(json.dumps(data,sort_keys=True))
    sys.exit(code)
if __name__=='__main__':main()
