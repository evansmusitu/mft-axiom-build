"""Read-only Cloudflare connection preflight using AXIOM's existing key path.

Credentials are supplied by an external secrets broker (e.g., the repo's
GitHub encrypted secrets). NEVER log, serialize, or copy the secret into Git.

This verifies only the account/zone. It cannot attest Workers AI Free plan,
zero billable overage, D1 access, or inference readiness.
"""
import json
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class CloudflareAuditError(RuntimeError):
    """Redacted Cloudflare access or invariant failure."""


_API = 'https://api.cloudflare.com/client/v4'
_ACCOUNT_ID = re.compile(r'^[0-9a-f]{32}$')
_EMAIL = re.compile(r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')
_ZONE = 'mftintelligence.com'


def audit_cloudflare_readonly(*, email, api_key, expected_account, api_get=urlopen):
    if not isinstance(email, str) or not _EMAIL.fullmatch(email):
        raise CloudflareAuditError('Cloudflare account email unavailable')
    if (not isinstance(api_key,str) or not api_key.startswith('cfk_') or
            len(api_key)<8 or not api_key.isascii() or
            any(ord(c)<33 or ord(c)>126 for c in api_key)):
        raise CloudflareAuditError('Cloudflare Global API Key unavailable or wrong auth type')
    if not isinstance(expected_account,str) or not _ACCOUNT_ID.fullmatch(expected_account):
        raise CloudflareAuditError('expected Cloudflare account ID invalid')
    headers = {'X-Auth-Email':email, 'X-Auth-Key':api_key,
               'Accept':'application/json','User-Agent':'MUSITU-Axiom-Cloudflare-ReadOnly/1'}
    def get(path):
        if path not in (
            '/zones?'+urlencode({'name':_ZONE,'status':'active'}),
            '/accounts/'+expected_account
        ):
            raise CloudflareAuditError('Cloudflare read-only path is not allowlisted')
        req=Request(_API+path,headers=headers,method='GET')
        try:
            with api_get(req,timeout=20) as resp:
                if getattr(resp,'status',None)!=200:
                    raise CloudflareAuditError('Cloudflare returned a non-200 response')
                data=resp.read(65537)
                if len(data)>65536:
                    raise CloudflareAuditError('Cloudflare response exceeded size limit')
                parsed=json.loads(data)
                if type(parsed) is not dict or parsed.get('success') is not True:
                    raise CloudflareAuditError('Cloudflare read-only API result not successful')
                return parsed
        except CloudflareAuditError:
            raise
        except Exception:
            raise CloudflareAuditError('Cloudflare read-only API call unavailable') from None
    zones=get('/zones?'+urlencode({'name':_ZONE,'status':'active'})).get('result')
    if type(zones) is not list or len(zones)!=1:
        raise CloudflareAuditError('exactly one active AXIOM zone required')
    zone=zones[0]
    if (type(zone) is not dict or zone.get('name')!=_ZONE or
        zone.get('status')!='active' or
        (zone.get('account') or {}).get('id')!=expected_account):
        raise CloudflareAuditError('Cloudflare zone/account authority mismatch')
    account=get('/accounts/'+expected_account).get('result')
    if type(account) is not dict or account.get('id')!=expected_account:
        raise CloudflareAuditError('Cloudflare account identity mismatch')
    return {
        'schema':'musitu.axiom.cloudflare.readonly_preflight.v1',
        'auth_mode':'X-Auth-Email+X-Auth-Key',
        'zone_name':_ZONE,
        'zone_status':'active',
        'account_id_last_four':expected_account[-4:],
        'cloudflare_account_read_only_verified':True,
        'free_plan_eligibility_verified':False,
        'billing_hard_stop_verified':False,
        'workers_ai_inference_verified':False,
        'public_inference_enabled':False,
        'write_performed':False,
        'credential_exposed':False,
        'production_authority':False,
    }


def main():
    import os
    import sys
    if (os.environ.get('AXIOM_CLOUDFLARE_READONLY_MODE')!='CONFIRMED_ISOLATED_READ' or
        os.environ.get('AXIOM_ZERO_CASH_BUDGET_USD')!='0'):
        print('AXIOM_CLOUDFLARE_READONLY_SCOPE_NOT_AUTHORIZED',file=sys.stderr)
        return 42
    try:
        result=audit_cloudflare_readonly(
            email=os.environ.get('CLOUDFLARE_EMAIL'),
            api_key=os.environ.get('CLOUDFLARE_GLOBAL_API_KEY'),
            expected_account=os.environ.get('AXIOM_EXPECTED_CLOUDFLARE_ACCOUNT_ID'),
        )
    except CloudflareAuditError:
        print('AXIOM_CLOUDFLARE_READONLY_NOT_VERIFIED',file=sys.stderr)
        return 43
    print(json.dumps(result,sort_keys=True))
    print('MUSITU_AXIOM_ESTABLISHED_CLOUDFLARE_READONLY_AUTH_PASS')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
