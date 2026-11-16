#!/usr/bin/env python3
"""MUSITU AXIOM Gate1: isolated Cloudflare Free ACCOUNT metadata candidate, NO_GO.

Owner-created account only. This module NEVER creates an account, database,
configures billing, performs SQL, modifies tenant data, or signs authorizations.
Source Paid Cloudflare account is immutable and explicitly rejected as target.
Unauthenticated GET failures, no active-paid-subscriptions, and current Free
caps are NOT provider payment/authority guarantees. No real secrets in CI.
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

SOURCE_ACCOUNT = '93f395f5121954671f92fffa453d6b61'
SOURCE_D1 = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
ACCOUNT_ID = re.compile(r'^[0-9a-f]{32}$')
SCHEMA = 'musitu.axiom.step1.isolated-free-account-readonly.v1'
FILE = 'axiom_step1_gate1_isolated_free_readonly_20261114.json'
LIMIT_DB_COUNT = 10
LIMIT_DB_BYTES = 500_000_000
PROVEN_SOURCE_SIZE_BYTES_AT_20261113 = 356_352
MAX_JSON = 100_000

class Denied(Exception): pass

def require(test, code):
    if not test: raise Denied(code)

def account_pin(account):
    require(isinstance(account, str) and ACCOUNT_ID.fullmatch(account) is not None,
            'REQUIRES_OWNER_VERIFIED_NEW_ACCOUNT_ID')
    require(account != SOURCE_ACCOUNT, 'PRODUCTION_ACCOUNT_REUSE_PROHIBITED')
    return account

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

def cloudflare_get(token, account, path):
    account_pin(account)
    allow = (f'/accounts/{account}',f'/accounts/{account}/subscriptions',
             f'/accounts/{account}/d1/database?page=1&per_page=100')
    require(path in allow, 'GET_ENDPOINT_NOT_ALLOWLISTED')
    require(isinstance(token,str) and len(token) > 5 and not any(c in token for c in '\n\r'),
            'READONLY_NEW_ACCOUNT_TOKEN_MISSING')
    req = urllib.request.Request('https://api.cloudflare.com/client/v4'+path,method='GET',
          headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=16) as res:
            require(res.status==200, 'PROVIDER_NOT_200')
            content=res.read(MAX_JSON+1)
            require(len(content)<=MAX_JSON,'OVERSIZED_METADATA')
            obj=json.loads(content)
            require(isinstance(obj,dict) and obj.get('success') is True,'INVALID_PROVIDER_ENVELOPE')
            return obj
    except urllib.error.HTTPError as ex:
        raise Denied('HTTP_'+str(ex.code)) from None
    except (urllib.error.URLError,OSError,TimeoutError,ValueError,UnicodeError):
        raise Denied('PROVIDER_GET_UNAVAILABLE') from None

def inspect(account,token, get=cloudflare_get,now=None):
    account_pin(account)
    now = now or datetime.now(timezone.utc)
    require(isinstance(now,datetime) and now.tzinfo is not None and now.utcoffset().total_seconds()==0,
            'UTC_CLOCK_REQUIRED')
    # Never reveal the raw new-account identifier in receipts/artifacts/logs.
    result=dict(schema=SCHEMA,checked_at_utc=now.isoformat(),
                new_account_sha256=hashlib.sha256(account.encode('ascii')).hexdigest(),
                source_account_preserved=True, source_database_preserved=True,
                account_metadata_http='UNREAD',account_identity_verified=False,
                subscriptions_http='UNREAD',all_active_paid_subscriptions_absent=False,
                explicit_workers_free_provider_plan_verified=False,
                d1_catalog_http='UNREAD',d1_catalog_complete=False,
                d1_database_count=None,isolation_candidate_empty=False,
                source_size_known_20261113_only_bytes=PROVEN_SOURCE_SIZE_BYTES_AT_20261113,
                source_file_fits_free_single_db_limit=True,
                import_row_write_volume_verified=False,
                free_account_5gb_storage_qualified=False,
                free_account_daily_usage_qualified=False,
                account_has_no_payment_method_independently_verified=False,
                independently_authenticated_owner_mfa_verified=False,
                signer_trust_anchor_activated=False,
                owner_operation_specific_signed_permission=False,
                provider_hard_zero_additional_spend_verified=False,
                target_creation_authorized=False, customer_export_authorized=False,
                customer_restore_authorized=False,provider_mutations=0,
                gate1_closed=False, step1_closed=False,step2_authorized=False,
                release_authorized=False,release_status='NOT_RELEASE',
                status='ISOLATED_FREE_CANDIDATE_NOT_AUTHORIZED_NO_GO')
    def request(path,label):
        try:
            data=get(token,account,path)
            require(isinstance(data,dict) and data.get('success') is True, 'PROVIDER_ENVELOPE_INVALID')
            result[label+'_http']=200
            return data
        except Denied as ex:
            result[label+'_http']=str(ex)
            return None
        except (KeyError,TypeError,ValueError):
            result[label+'_http']='UNRECOGNIZED_RESPONSE'
            return None
    d=request(f'/accounts/{account}','account_metadata')
    if d is not None:
        item=d.get('result')
        result['account_identity_verified']=isinstance(item,dict) and item.get('id')==account
    d=request(f'/accounts/{account}/subscriptions','subscriptions')
    if d is not None:
        rows=d.get('result')
        if isinstance(rows,list) and len(rows)<=1000 and all(isinstance(x,dict) for x in rows):
            # Empty/zero active paid subscriptions is only a weak negative signal.
            active={'Paid','Active','Provisioned','Trial','AwaitingPayment'}
            result['all_active_paid_subscriptions_absent']=all(x.get('state') not in active for x in rows)
        else: result['subscriptions_http']='INVALID_SUBSCRIPTION_LIST'
    d=request(f'/accounts/{account}/d1/database?'+urlencode({'page':1,'per_page':100}), 'd1_catalog')
    if d is not None:
        entries,info=d.get('result'),d.get('result_info')
        valid=isinstance(entries,list) and isinstance(info,dict)
        valid=valid and all(type(info.get(k)) is int for k in ('page','per_page','count','total_count'))
        valid=valid and info['page']==1 and info['per_page']==100 and info['count']==len(entries)
        valid=valid and info['total_count']==len(entries) and len(entries)<=100
        if valid:
            ids=set();names=set()
            for x in entries:
                if not isinstance(x,dict) or not isinstance(x.get('uuid'),str) or not isinstance(x.get('name'),str) or x['uuid'] in ids or x['name'] in names:
                    valid=False;break
                ids.add(x['uuid']);names.add(x['name'])
            if valid and SOURCE_D1 not in ids:
                result['d1_catalog_complete']=True
                result['d1_database_count']=len(entries)
                result['isolation_candidate_empty']=len(entries)==0
            else: result['d1_catalog_http']='UNSAFE_OR_UNVERIFIED_CATALOG'
        else:result['d1_catalog_http']='INCOMPLETE_CATALOG'
    # These items can be useful as a negative preflight, but never a GO decision.
    require(result['gate1_closed'] is False and result['provider_hard_zero_additional_spend_verified'] is False
            and result['target_creation_authorized'] is False,'UNAUTHORIZED_GATE_PROMOTION')
    return result

def main():
    account=os.getenv('AXIOM_GATE1_OWNER_FREE_ACCOUNT_ID','')
    token=os.getenv('AXIOM_GATE1_OWNER_FREE_ACCOUNT_READ_TOKEN','')
    try: result=inspect(account,token)
    except Denied as ex:
        result={'schema':SCHEMA,'status':'ISOLATED_FREE_PROBE_PRECONDITION_NO_GO',
                'sanitized_error':str(ex), 'gate1_closed':False,'step1_closed':False,
                'step2_authorized':False,'release_authorized':False,'release_status':'NOT_RELEASE'}
    raw=(json.dumps(result,sort_keys=True,indent=2)+'\n').encode()
    Path(FILE).write_bytes(raw)
    Path(FILE+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+FILE+'\n',encoding='utf8')
    print('AXIOM_GATE1_NEW_FREE_ACCOUNT_PROBE_METADATA_ONLY_NO_GO_NOT_RELEASE')
    for k in ('status','account_identity_verified','all_active_paid_subscriptions_absent',
              'd1_catalog_complete','isolation_candidate_empty','target_creation_authorized',
              'gate1_closed'):
        if k in result:print(k+'='+str(result[k]))
    return 0 if result.get('account_identity_verified') and result.get('d1_catalog_complete') else 2

if __name__=='__main__':
    raise SystemExit(main())
