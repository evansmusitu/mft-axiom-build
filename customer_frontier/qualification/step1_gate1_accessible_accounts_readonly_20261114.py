#!/usr/bin/env python3
"""Gate1 Cloudflare account CATALOG metadata-only discovery; NEVER choose target.

Only GET /accounts pages under existing token. Does not inspect OTHER accounts,
returns no names, ids (except pinned original), emails, auth data, account types,
role detail, private keys or customer D1 data. NO_GO in every possible outcome.
"""
import hashlib,json,os,re,urllib.error,urllib.request
from datetime import datetime, timezone
from urllib.parse import urlencode
SOURCE='93f395f5121954671f92fffa453d6b61'
UUID=re.compile(r'^[0-9a-f]{32}$')
SCHEMA='musitu.axiom.step1.account-discovery-readonly.v1'
NAME='axiom_step1_gate1_accessible_accounts_readonly_20261114.json'
PER_PAGE=50
MAX_PAGES=5

class NoGo(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def getter(token,path):
    if not isinstance(token,str) or len(token)<6 or any(x in token for x in '\r\n'):raise NoGo('TOKEN_NOT_AVAILABLE')
    if not re.fullmatch(r'/accounts\?page=[1-5]&per_page=50',path):raise NoGo('ONLY_PAGINATED_GET_ACCOUNT_METADATA_ALLOWED')
    req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,method='GET',headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=17) as res:
            if res.status!=200:raise NoGo('HTTP_NOT_200')
            b=res.read(200001)
            if len(b)>200000:raise NoGo('RESPONSE_OVERSIZED')
            return json.loads(b)
    except urllib.error.HTTPError as e:raise NoGo('HTTP_'+str(e.code)) from None
    except (urllib.error.URLError,TimeoutError,OSError,UnicodeError,ValueError):raise NoGo('GET_UNAVAILABLE') from None

def validate_page(doc,page,total=None,seen=None):
    if seen is None:seen=set()
    if not isinstance(doc,dict) or doc.get('success') is not True:raise NoGo('PROVIDER_ENVELOPE_INVALID')
    entries,info=doc.get('result'),doc.get('result_info')
    if not isinstance(entries,list) or not isinstance(info,dict):raise NoGo('PAGE_RESPONSE_MISSING')
    if not all(type(info.get(k)) is int for k in ('page','per_page','count','total_count')):raise NoGo('PAGE_FIELDS_INVALID')
    if info['page']!=page or info['per_page']!=PER_PAGE or info['count']!=len(entries) or info['total_count']<1 or info['total_count']>MAX_PAGES*PER_PAGE:
        raise NoGo('PAGE_BOUNDS_OR_TOTAL_INVALID')
    if total is not None and info['total_count']!=total:raise NoGo('CATALOG_CHANGED_DURING_PAGINATION')
    total=info['total_count']
    expected=min(PER_PAGE,max(0,total-(page-1)*PER_PAGE))
    if len(entries)!=expected:raise NoGo('PAGE_ITEMS_INCOMPLETE')
    ids=[]
    for item in entries:
        if not isinstance(item,dict) or not isinstance(item.get('id'),str) or not UUID.fullmatch(item['id']) or item['id'] in seen or item['id'] in ids:
            raise NoGo('INVALID_OR_DUPLICATE_ACCOUNT')
        ids.append(item['id'])
    return total,set(ids)

def audit(get=getter,token=None,now=None):
    if now is None:now=datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset().total_seconds()!=0:raise NoGo('UTC_TIME_REQUIRED')
    if token is None:token=os.environ.get('CLOUDFLARE_API_TOKEN','')
    response={
      'schema':SCHEMA,'captured_at_utc':now.isoformat(),
      'source_account':SOURCE,'operation':'GET_ONLY_CLOUDFLARE_ACCOUNTS_LIST',
      'account_list_qualified':False,'account_catalog_total':None,
      'original_account_accessible':False,'other_accessible_accounts_count':None,
      'other_accounts_free_plan_proven':False,
      'other_accounts_owned_by_original_owner_verified':False,
      'other_account_read_scope_authorized':False,
      'new_free_target_selected':False,'owner_mfa_independently_qualified':False,
      'paid_source_unchanged':True,'provider_spend_guarantee_qualified':False,
      'provider_mutations':0,'gate1_closed':False,'step1_closed':False,
      'step2_authorized':False,'release_authorized':False,'release_status':'NOT_RELEASE',
      'status':'NO_OTHER_ACCOUNT_PERMISSION_OR_FREE_PLAN_VERIFIED_NO_GO'
    }
    try:
        allids=set();total=None
        for page in range(1,MAX_PAGES+1):
            path='/accounts?'+urlencode({'page':page,'per_page':PER_PAGE})
            doc=get(token,path)
            total,got=validate_page(doc,page,total,allids)
            allids.update(got)
            if len(allids)==total:break
        if len(allids)!=total:raise NoGo('INCOMPLETE_OR_TRUNCATED_ACCOUNT_CATALOG')
        response['account_list_qualified']=True
        response['account_catalog_total']=total
        response['original_account_accessible']=SOURCE in allids
        response['other_accessible_accounts_count']=len(allids)-int(SOURCE in allids)
        response['status']='ACCOUNT_CATALOG_METADATA_OBSERVED_ONLY_NO_GO'
    except NoGo as e:
        response['sanitized_error']=str(e)
    except (KeyError,TypeError,ValueError):
        response['sanitized_error']='INVALID_PROVIDER_RESPONSE'
    return response

def main():
    r=audit()
    data=(json.dumps(r,sort_keys=True,indent=2)+'\n').encode()
    open(NAME,'wb').write(data)
    open(NAME+'.sha256','w').write(hashlib.sha256(data).hexdigest()+'  '+NAME+'\n')
    print('AXIOM_GATE1_CLOUDFLARE_ACCOUNT_CATALOG_METADATA_ONLY_NO_GO_NOT_RELEASE')
    for field in ('status','account_list_qualified','account_catalog_total','original_account_accessible','other_accessible_accounts_count','gate1_closed'):
        print(field+'='+str(r.get(field)))

if __name__=='__main__':main()
