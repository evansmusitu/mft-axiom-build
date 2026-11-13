#!/usr/bin/env python3
"""Gate1: assess ONLY source metadata size against published Free D1 database bound.

GET pinned source database metadata via existing token; no SQL/rows/export;
not permission to create or select an account, and not an estimate of import
row-write cost. Historical Paid account is never misrepresented as Free.
"""
import hashlib
import json
import math
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

ACCOUNT='93f395f5121954671f92fffa453d6b61'
SOURCE='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
MAX_FREE_BYTES_CONSERVATIVE=500_000_000
SCHEMA='musitu.axiom.step1.free-d1-isolated-feasibility-readonly.v1'
OUT='axiom_step1_free_d1_feasibility_readonly_20261113.json'

class NoGo(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None

def source_metadata_get(token):
    if not isinstance(token,str) or not token or '\n' in token or '\r' in token:raise NoGo('TOKEN_UNAVAILABLE')
    path='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+SOURCE
    req=urllib.request.Request(path,method='GET',headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=16) as response:
            if response.status!=200:raise NoGo('SOURCE_HTTP_NOT_200')
            raw=response.read(100001)
            if len(raw)>100000:raise NoGo('OVERSIZED_SOURCE_METADATA')
            data=json.loads(raw)
            if not isinstance(data,dict) or data.get('success') is not True:raise NoGo('SOURCE_ENVELOPE_INVALID')
            return data
    except urllib.error.HTTPError as exc:raise NoGo('SOURCE_HTTP_'+str(exc.code)) from None
    except (urllib.error.URLError,ValueError,UnicodeError,TimeoutError,OSError):raise NoGo('SOURCE_GET_UNAVAILABLE') from None

def assess(doc):
    if not isinstance(doc,dict) or doc.get('success') is not True or not isinstance(doc.get('result'),dict):raise NoGo('BAD_SOURCE_RESPONSE')
    d=doc['result']
    if d.get('uuid')!=SOURCE:raise NoGo('SOURCE_UUID_DRIFT')
    n=d.get('file_size')
    known=(type(n) in (int,float) and math.isfinite(n) and
           n>=0 and float(n).is_integer())
    n=int(n) if known else None
    within=known and n<=MAX_FREE_BYTES_CONSERVATIVE
    return {
      'schema':SCHEMA,
      'checked_at_utc':datetime.now(timezone.utc).isoformat(),
      'current_account':ACCOUNT,'source_uuid':SOURCE,
      'provider_operation':'GET_ONLY_SOURCE_METADATA',
      'source_detail_http':200,'source_uuid_matched':True,
      'source_file_size_bytes':n,
      'source_file_size_known':bool(known),
      'free_single_database_limit_bytes_conservative':MAX_FREE_BYTES_CONSERVATIVE,
      'source_file_size_fits_free_single_db_conservative':bool(within),
      'free_plan_database_limit':10,
      'free_plan_5gb_total_storage_unverified':True,
      'free_plan_daily_written_row_limit':100000,
      'free_plan_daily_reads_rows_limit':5000000,
      'free_account_provisioned_or_verified':False,
      'free_account_billing_plan_verified':False,
      'free_account_no_paid_services_verified':False,
      'free_account_daily_usage_measured':False,
      'free_account_restore_row_writes_proven_within_daily_limit':False,
      'source_backup_authorized':False,
      'new_free_account_or_target_creation_authorized':False,
      'hosted_restore_authorized':False,
      'current_paid_account_d1_zero_spend_guaranteed':False,
      'gate1_closed':False,'step1_closed':False,'step2_authorized':False,
      'release_authorized':False,'release_status':'NOT_RELEASE',
      'status':'FREE_PLAN_DATABASE_SIZE_ONLY_METADATA_NO_GO_NOT_RELEASE'
    }

def main():
    try:
        res=assess(source_metadata_get(os.environ.get('CLOUDFLARE_API_TOKEN','')))
    except NoGo as exc:
        res={'schema':SCHEMA,'status':'SOURCE_FREE_FEASIBILITY_METADATA_UNQUALIFIED_NO_GO',
             'sanitized_error':str(exc),'gate1_closed':False,'step1_closed':False,
             'step2_authorized':False,'release_authorized':False,'release_status':'NOT_RELEASE'}
    payload=(json.dumps(res,sort_keys=True,indent=2)+'\n').encode()
    open(OUT,'wb').write(payload)
    open(OUT+'.sha256','w').write(hashlib.sha256(payload).hexdigest()+'  '+OUT+'\n')
    print('AXIOM_GATE1_FREE_D1_FEASIBILITY_METADATA_GETONLY_NO_GO_NOT_RELEASE')
    for k in ('source_detail_http','source_file_size_known','source_file_size_bytes',
              'source_file_size_fits_free_single_db_conservative','free_account_provisioned_or_verified',
              'gate1_closed'):
        if k in res:print(k+'='+str(res[k]))

if __name__=='__main__':main()
