#!/usr/bin/env python3
"""AXIOM Step 1: exact-account, GET-only, fully paginated D1 target-name preflight.

NO_GO: never creates databases, queries SQL, exports identity rows or estimates an
account-wide zero-billing guarantee. Strictly non-authorizing, read-only evidence.
"""
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlencode

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
SOURCE = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
RESERVED_OAUTH_DR = 'c023a0a0-472a-4178-ad07-02f1d6b2e122'
PROPOSED_NAME = 'axiom-idp-step1-disposable-restore-20261112-11563925'
SCHEMA = 'musitu.axiom.step1.owner-target-catalog-readonly.v1'
UUID = re.compile(r'^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$')
MAX_PAGES = 5
PAGE_SIZE = 100
MAX_RESPONSE_BYTES = 200_000


class AuditNoGo(Exception):
    """Fail closed without carrying provider response text into logs."""


def _require(ok, reason):
    if not ok:
        raise AuditNoGo(reason)


def validate_full_catalog(pages):
    """Verify every page and total. Never treat one 200 response as a complete list."""
    _require(isinstance(pages, list) and 1 <= len(pages) <= MAX_PAGES, 'INVALID_PAGE_SET')
    total = None
    entries = []
    seen_uuids, seen_names = set(), set()
    for idx, doc in enumerate(pages, 1):
        _require(isinstance(doc, dict) and doc.get('success') is True, 'INVALID_PROVIDER_PAGE')
        items, info = doc.get('result'), doc.get('result_info')
        _require(isinstance(items, list) and isinstance(info, dict), 'MISSING_PAGE_DATA')
        _require(all(type(info.get(k)) is int for k in ('page','per_page','count','total_count')), 'INVALID_PAGE_COUNTS')
        _require(info['page'] == idx and info['per_page'] == PAGE_SIZE and info['count'] == len(items), 'INCONSISTENT_PAGINATION')
        _require(0 <= info['total_count'] <= MAX_PAGES * PAGE_SIZE, 'UNBOUNDED_CATALOG')
        if total is None: total = info['total_count']
        _require(total == info['total_count'], 'CATALOG_CHANGED_BETWEEN_PAGES')
        # The provider advertises a fixed-size page except its final page.
        expected = min(PAGE_SIZE, max(0, total - (idx - 1) * PAGE_SIZE))
        _require(len(items) == expected, 'INCOMPLETE_PAGE')
        for item in items:
            _require(isinstance(item, dict), 'INVALID_CATALOG_ITEM')
            ident, name = item.get('uuid'), item.get('name')
            _require(isinstance(ident, str) and UUID.fullmatch(ident) is not None, 'INVALID_UUID')
            _require(isinstance(name, str) and 1 <= len(name) <= 200, 'INVALID_DATABASE_NAME')
            _require(ident not in seen_uuids and name not in seen_names, 'DUPLICATE_DATABASE_RECORD')
            seen_uuids.add(ident);seen_names.add(name)
            entries.append((ident, name))
    _require(total == len(entries), 'CATALOG_INCOMPLETE')
    _require(SOURCE in seen_uuids, 'ORIGINAL_DATABASE_NOT_LISTED')
    _require(RESERVED_OAUTH_DR in seen_uuids, 'RESERVED_DATABASE_NOT_LISTED')
    digest = hashlib.sha256(json.dumps(sorted(entries), separators=(',',':')).encode()).hexdigest()
    return {'database_count':total,
            'complete_catalog_pages':len(pages),
            'catalog_sha256':digest,
            'proposed_target_name_sha256':hashlib.sha256(PROPOSED_NAME.encode()).hexdigest(),
            'proposed_target_name_absent':PROPOSED_NAME not in seen_names,
            'source_present':SOURCE in seen_uuids,
            'reserved_oauth_dr_present':RESERVED_OAUTH_DR in seen_uuids}


def paid_workers_subscription(doc):
    _require(isinstance(doc,dict) and doc.get('success') is True and isinstance(doc.get('result'),list), 'SUBSCRIPTION_INVALID')
    for sub in doc['result']:
        if not isinstance(sub,dict):continue
        plan = sub.get('rate_plan') or {}
        if isinstance(plan,dict) and any('worker' in str(plan.get(k,'')).lower() for k in ('id','name')):
            return sub.get('state') == 'Paid'
    return False


def source_detail_matches(doc):
    _require(isinstance(doc,dict) and doc.get('success') is True and isinstance(doc.get('result'),dict), 'SOURCE_DETAIL_INVALID')
    return doc['result'].get('uuid') == SOURCE


def metadata_receipt(pages, source_detail, subscriptions, captured_at=None):
    """Sanitized, non-authorizing receipt. Tests and live script share this function."""
    result=validate_full_catalog(pages)
    src=source_detail_matches(source_detail)
    paid=paid_workers_subscription(subscriptions)
    _require(src, 'SOURCE_UUID_MISMATCH')
    # Even a true database-count allowance is not a no-extra-cost guarantee.
    return {
      'schema':SCHEMA,
      'captured_at_utc':captured_at or datetime.now(timezone.utc).isoformat(),
      'source_account':ACCOUNT,'source_database':SOURCE,
      **result,
      'source_uuid_detail_matched':src,
      'workers_paid_active':paid,
      'database_quantity_within_published_included_band':paid and result['database_count'] < 100000,
      'published_paid_database_allowance':100000,
      'source_identity_data_read':False,
      'cloudflare_methods':'GET_ONLY_METADATA',
      'approved_target_exists':False,
      'proposed_target_is_created':False,
      'owner_cryptographic_permit_qualified':False,
      'owner_encryption_key_qualified':False,
      'provider_account_wide_uncharged_usage_qualified':False,
      'provider_zero_additional_spend_qualified':False,
      'current_encrypted_source_backup_qualified':False,
      'hosted_restore_parity_qualified':False,
      'tenant_least_privilege_qualified':False,
      'b27_synthetic_cas':'FAIL','pr83_fullstack':'FAIL',
      'step1_closed':False,'step2_authorized':False,'release':'NOT_RELEASE',
      'status':'TARGET_NAME_INVENTORY_ONLY_NO_GO' if result['proposed_target_name_absent'] else 'TARGET_NAME_COLLISION_NO_GO'
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def cloudflare_get(token, path):
    """Strictly whitelist GET endpoints, never follows a redirect or prints raw data."""
    accepted=(re.fullmatch(r'/d1/database\?page=[1-5]&per_page=100',path) is not None) or path in (f'/d1/database/{SOURCE}','/subscriptions')
    _require(accepted,'UNAPPROVED_HTTP_PATH')
    _require(isinstance(token,str) and len(token)>0 and '\r' not in token and '\n' not in token,'TOKEN_UNAVAILABLE')
    url='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+path
    req=urllib.request.Request(url,method='GET',headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=20) as response:
            _require(response.status == 200,'PROVIDER_HTTP_NON_200')
            raw=response.read(MAX_RESPONSE_BYTES+1)
            _require(len(raw) <= MAX_RESPONSE_BYTES,'OVERSIZED_RESPONSE')
            return json.loads(raw.decode('utf-8'))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise AuditNoGo('PROVIDER_GET_FAILED') from None


def audit_live(token, get=cloudflare_get):
    page=1;pages=[];expected_pages=None
    while True:
        doc=get(token,'/d1/database?'+urlencode({'page':page,'per_page':PAGE_SIZE}))
        pages.append(doc)
        info=doc.get('result_info') if isinstance(doc,dict) else None
        _require(isinstance(info,dict) and type(info.get('total_count')) is int,'MISSING_TOTAL_COUNT')
        total=info['total_count']
        _require(0 <= total <= MAX_PAGES * PAGE_SIZE,'TOO_MANY_DATABASES_TO_AUDIT')
        calculated=max(1,(total+PAGE_SIZE-1)//PAGE_SIZE)
        if expected_pages is None: expected_pages=calculated
        _require(expected_pages == calculated,'CHANGING_PROVIDER_CATALOG')
        if page>=expected_pages: break
        page+=1
        _require(page<=MAX_PAGES,'PAGE_BOUND_EXCEEDED')
    return metadata_receipt(pages,get(token,'/d1/database/'+SOURCE),get(token,'/subscriptions'))


def main():
    # Print no provider response data, account member PII, secrets or credentials.
    try:
        result=audit_live(os.environ.get('CLOUDFLARE_API_TOKEN',''))
    except (AuditNoGo, KeyError, TypeError) as ex:
        result={
          'schema':SCHEMA,
          'status':'CATALOG_VALIDATION_FAILED_NO_GO',
          'sanitized_error_code':str(ex) if isinstance(ex,AuditNoGo) else 'INVALID_DATA',
          'catalog_qualified':False,
          'provider_zero_additional_spend_qualified':False,
          'step1_closed':False,'step2_authorized':False,'release':'NOT_RELEASE'
        }
    out='axiom_step1_owner_target_catalog_readonly_20261112.json'
    payload=(json.dumps(result,indent=2,sort_keys=True)+'\n').encode()
    with open(out,'wb') as f: f.write(payload)
    with open(out+'.sha256','w') as f: f.write(hashlib.sha256(payload).hexdigest()+'  '+out+'\n')
    print('AXIOM_STEP1_TARGET_CATALOG_METADATA_NO_GO_NOT_RELEASE')
    if result['status']=='CATALOG_VALIDATION_FAILED_NO_GO':raise SystemExit(2)


if __name__=='__main__':main()
