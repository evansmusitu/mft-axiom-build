"""Supplemental account-native Cloudflare billing metadata read, fail closed.

Uses the already-established Global API Key in protected runtime secrets and
Cloudflare's documented subscription and Workers-settings GET endpoints.
This cannot determine Workers AI free eligibility, pricing hard stops, or
customer-use authorization. No secret values or subscription details are emitted.
"""
import json
import math
import re
from urllib.request import Request, urlopen

from cloudflare_readonly import audit_cloudflare_readonly, CloudflareAuditError

_API = 'https://api.cloudflare.com/client/v4'
_ACC = re.compile(r'^[a-f0-9]{32}$')
_EMAIL = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')

class CloudflareBillingEvidenceError(RuntimeError):
    """Sanitized read-only Cloudflare billing outcome, not evidence of free tier."""


def inspect_cloudflare_billing_readonly(*, email, api_key, expected_account, api_get=urlopen):
    if (type(email) is not str or not _EMAIL.fullmatch(email) or
        type(api_key) is not str or not api_key.startswith('cfk_') or
        len(api_key) < 8 or not api_key.isascii() or
        any(ord(c)<33 or ord(c)>126 for c in api_key) or
        type(expected_account) is not str or not _ACC.fullmatch(expected_account)):
        raise CloudflareBillingEvidenceError('established read-only Cloudflare identity unavailable')
    # Binding to AXIOM's exact active zone, verified before billing reads.
    try:
        authority = audit_cloudflare_readonly(
            email=email,api_key=api_key,expected_account=expected_account,
            api_get=api_get)
        if authority.get('cloudflare_account_read_only_verified') is not True:
            raise CloudflareBillingEvidenceError('Cloudflare identity not proven')
    except CloudflareAuditError:
        raise CloudflareBillingEvidenceError('Cloudflare zone or account identity not proven') from None

    headers={'X-Auth-Email':email,'X-Auth-Key':api_key,
             'Accept':'application/json','User-Agent':'MUSITU-Axiom-Zero-Cash-Billing-ReadOnly/1'}
    paths={
        'subscriptions':f'/accounts/{expected_account}/subscriptions',
        'settings':f'/accounts/{expected_account}/workers/account-settings',
    }
    def get(name):
        path=paths[name]
        if name not in paths or not path.startswith(f'/accounts/{expected_account}/'):
            raise CloudflareBillingEvidenceError('unsupported account read route')
        req=Request(_API+path,headers=headers,method='GET')
        try:
            with api_get(req,timeout=20) as res:
                if getattr(res,'status',None)!=200:
                    raise CloudflareBillingEvidenceError('Cloudflare read-only billing HTTP failure')
                raw=res.read(65537)
                if len(raw)>65536:
                    raise CloudflareBillingEvidenceError('Cloudflare billing response exceeded bound')
                record=json.loads(raw)
                if type(record) is not dict or record.get('success') is not True:
                    raise CloudflareBillingEvidenceError('Cloudflare billing query unsuccessful')
                if name == 'subscriptions':
                    info = record.get('result_info')
                    if info is not None:
                        if type(info) is not dict:
                            raise CloudflareBillingEvidenceError('billing pagination metadata invalid')
                        total = info.get('total_count')
                        if type(total) is not int or total < 0:
                            raise CloudflareBillingEvidenceError('billing pagination total invalid')
                        result = record.get('result')
                        if type(result) is not list or len(result) != total:
                            raise CloudflareBillingEvidenceError('billing subscriptions page is incomplete')
                return record.get('result')
        except CloudflareBillingEvidenceError:
            raise
        except Exception:
            raise CloudflareBillingEvidenceError('Cloudflare billing read failed closed') from None

    subscriptions=get('subscriptions')
    if type(subscriptions) is not list or len(subscriptions)>200:
        raise CloudflareBillingEvidenceError('Cloudflare subscriptions shape not admitted')
    has_paid=False
    for row in subscriptions:
        if type(row) is not dict:
            raise CloudflareBillingEvidenceError('Cloudflare subscription record malformed')
        price=row.get('price')
        if price is not None:
            if type(price) not in (int,float) or not math.isfinite(price) or price<0:
                raise CloudflareBillingEvidenceError('Cloudflare price field malformed')
            if price>0:has_paid=True
    settings=get('settings')
    if type(settings) is not dict:
        raise CloudflareBillingEvidenceError('Cloudflare Workers account settings not readable')
    mode=settings.get('default_usage_model')
    if mode is not None and (type(mode) is not str or len(mode)>64):
        raise CloudflareBillingEvidenceError('Cloudflare Workers usage model field malformed')
    # Never echo subscriber names, IDs, prices, details, or secrets into CI logs.
    return {
        'schema':'musitu.axiom.cloudflare.free_cost_account_native_read.v1',
        'read_endpoints':['account_subscriptions','workers_account_settings'],
        'cloudflare_zone_account_verified':True,
        'billing_read_only_endpoint_success':True,
        'subscriptions_returned':len(subscriptions),
        'paid_subscription_observed':has_paid,
        'workers_usage_model_observed':mode if mode in ('bundled','unbound') else 'UNKNOWN',
        'workers_ai_free_plan_qualified':False,
        'billing_overage_hard_stop_verified':False,
        'commercial_customer_use_authorized':False,
        'actual_inference_verified':False,
        'account_level_charge_risk_eliminated':False,
        'no_secret_values_returned':True,
        'public_release_authority':False,
        'write_performed':False,
    }


def main():
    import os
    import sys
    if (os.environ.get('AXIOM_CLOUDFLARE_READONLY_MODE')!='CONFIRMED_ISOLATED_READ' or
        os.environ.get('AXIOM_ZERO_CASH_BUDGET_USD')!='0'):
        print('AXIOM_CLOUDFLARE_BILLING_READ_SCOPE_NOT_AUTHORIZED',file=sys.stderr)
        return 42
    try:
        receipt=inspect_cloudflare_billing_readonly(
            email=os.environ.get('CLOUDFLARE_EMAIL'),
            api_key=os.environ.get('CLOUDFLARE_GLOBAL_API_KEY'),
            expected_account=os.environ.get('AXIOM_EXPECTED_CLOUDFLARE_ACCOUNT_ID'),
        )
    except CloudflareBillingEvidenceError:
        print('AXIOM_CLOUDFLARE_BILLING_READ_NOT_VERIFIED',file=sys.stderr)
        return 43
    print(json.dumps(receipt,sort_keys=True))
    print('MUSITU_AXIOM_CLOUDFLARE_BILLING_METADATA_READ_ONLY_PASS')
    print('MUSITU_AXIOM_WORKERS_AI_ZERO_CASH_HARD_STOP=NOT_PROVEN')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
