"""Sanitized exact-account Cloudflare eligibility preflight. GET only.
NO resource creation, SQL, billing mutation, secret export or cutover.
An account subscription read cannot prove Workers Free or hard $0 billing.
"""
from __future__ import annotations
import json,os,urllib.error,urllib.request
ACCOUNT="93f395f5121954671f92fffa453d6b61"
BASE="/accounts/"+ACCOUNT
ALLOWED=frozenset({BASE,BASE+"/d1/database?per_page=100",BASE+"/subscriptions"})

class ProviderReadError(Exception):
    pass

def _status(status,body):
    return status==200 and type(body) is dict and body.get("success") is True

def preflight(get):
    try:
        code,body=get(BASE)
    except Exception:
        raise ProviderReadError("account_not_verified") from None
    if not _status(code,body) or type(body.get("result")) is not dict or body["result"].get("id")!=ACCOUNT:
        raise ProviderReadError("account_not_verified")
    d1_status="unverified";count=None
    try:
        code,body=get(BASE+"/d1/database?per_page=100")
        if code in (401,403):d1_status="permission_denied"
        elif _status(code,body):
            data=body.get("result");info=body.get("result_info")
            if (type(data) is list and type(info) is dict and type(info.get("total_count")) is int
                and type(info.get("count")) is int and info["count"]==len(data)
                and info["total_count"]>=len(data)):
                if info["total_count"]==len(data):d1_status="authorized";count=len(data)
                else:d1_status="partial_page"
    except Exception:
        d1_status="unverified"
    subscriptions="unverified"
    try:
        code,body=get(BASE+"/subscriptions")
        if code in (401,403):subscriptions="permission_denied"
        elif _status(code,body) and type(body.get("result")) is list:
            subscriptions="authorized"
    except Exception:
        subscriptions="unverified"
    return {
        "schema":"lifeline.cloudflare_d1_readonly_eligibility.v1",
        "exact_account_verified":True,"d1_list_read_status":d1_status,
        "d1_database_count":count,"account_subscription_read_status":subscriptions,
        "workers_free_plan_verified":False,"hard_zero_dollar_spending_cap_verified":False,
        "provisioning_authorized":False,"d1_or_worker_created":False,
        "credentials_logged":False,"mutation_performed":False,
        "native_windows_host_connected":False,"trading_enabled":False
    }

def cloudflare_get(token,path):
    """No arbitrary request target/method; all credentials hidden from logs."""
    if path not in ALLOWED or not token or len(token)<15:
        raise ProviderReadError("invalid_readonly_request")
    req=urllib.request.Request("https://api.cloudflare.com/client/v4"+path,
       headers={"Authorization":"Bearer "+token,"Accept":"application/json",
                "User-Agent":"LIFELINE-D1-ReadOnly-NoSpend/1"},method="GET")
    try:
        with urllib.request.urlopen(req,timeout=15) as r:
            if r.status!=200:return r.status,None
            raw=r.read(131073)
            if len(raw)>131072:return 413,None
            return r.status,json.loads(raw)
    except urllib.error.HTTPError as e:return e.code,None
    except Exception:return 0,None

def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<15:raise SystemExit("cloudflare_readonly_preflight_not_authorized")
    try:report=preflight(lambda path:cloudflare_get(token,path))
    except ProviderReadError:
        raise SystemExit("exact_lifeline_account_not_verified") from None
    print(json.dumps(report,sort_keys=True))

if __name__=="__main__":main()
