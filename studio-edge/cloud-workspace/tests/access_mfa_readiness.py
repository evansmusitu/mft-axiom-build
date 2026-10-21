"""Strictly read-only inventory of configured Cloudflare Access IdP types.

Never conflates an IdP's presence with enforced MFA. Reports only provider
types/counts; never names, emails, provider IDs, tokens or user identities.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from access_hold_bootstrap import (
    ACCOUNT, DOMAIN, HOST, APP_NAME, ensure_account,
    existing_apps, check_deny_all_app, api, HoldBlocked,
)

BASE="https://api.cloudflare.com/client/v4"
ARTIFACT=Path("musitu-cloud-workspace-mfa-readiness.json")


def list_idps(token, opener=urllib.request.urlopen):
    path=f"/accounts/{ACCOUNT}/access/identity_providers"
    req=urllib.request.Request(BASE+path,headers={
        "Authorization":"Bearer "+token,"Accept":"application/json"},method="GET")
    try:
        with opener(req,timeout=18) as response:
            if response.status!=200:raise HoldBlocked("IDP_STATUS_INVALID")
            raw=response.read(262145)
    except urllib.error.HTTPError as error:
        raise HoldBlocked("IDP_HTTP_"+str(error.code)) from None
    except urllib.error.URLError:
        raise HoldBlocked("IDP_NETWORK_UNAVAILABLE") from None
    if len(raw)>262144:raise HoldBlocked("IDP_RESPONSE_OVERSIZE")
    try:
        result=json.loads(raw)
    except (ValueError,TypeError):
        raise HoldBlocked("IDP_JSON_INVALID") from None
    if not isinstance(result,dict) or result.get("success") is not True:
        raise HoldBlocked("IDP_API_REJECTED")
    providers=result.get("result")
    if not isinstance(providers,list):raise HoldBlocked("IDP_LIST_INVALID")
    if len(providers)>100:raise HoldBlocked("IDP_LIST_INCOMPLETE")
    info=result.get("result_info")
    if isinstance(info,dict) and info.get("total_count",len(providers))!=len(providers):
        raise HoldBlocked("IDP_LIST_INCOMPLETE")
    if any(not isinstance(p,dict) or not isinstance(p.get("type"),str) for p in providers):
        raise HoldBlocked("IDP_LIST_INVALID")
    return sorted([p["type"].lower() for p in providers])


def inspect(token,opener=urllib.request.urlopen):
    ensure_account(token,opener)
    apps=existing_apps(token,opener)
    matching=[app for app in apps if isinstance(app,dict) and
              (app.get("domain")==HOST or app.get("name")==APP_NAME)]
    if len(matching)!=1 or matching[0].get("domain")!=HOST:
        raise HoldBlocked("HOLD_APP_NOT_UNIQUE")
    id=matching[0].get("id")
    if not isinstance(id,str):raise HoldBlocked("HOLD_APP_ID_INVALID")
    app=api("GET",f"/accounts/{ACCOUNT}/access/apps/{id}",
            token,opener=opener).get("result")
    hold=check_deny_all_app(app,token,opener)
    types=list_idps(token,opener=opener)
    return {
        "schema":"musitu.cloud_workspace.mfa_readiness.v1",
        "account_id":ACCOUNT,"domain":DOMAIN,"private_hostname":HOST,
        "access_app_present":True,"access_app_no_allow_policies":hold["access_policies"]==0,
        "identity_provider_count":len(types),"identity_provider_types":types,
        "mfa_cryptographically_verified":False,
        "owner_interactive_mfa_verified":False,
        "tenant_membership_created":False,"worker_publicly_routed":False,
        "cloud_workspace_enabled":False,
        "assessment":"ACCESS_DENY_ALL_IDP_INVENTORY_ONLY"
    }


def main():
    if os.environ.get("EXPECTED_ACCOUNT_ID")!=ACCOUNT or os.environ.get("EXPECTED_DOMAIN")!=DOMAIN:
        print("BLOCKED: canonical account not selected")
        return 2
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if not token:
        print("BLOCKED: Cloudflare credential missing")
        return 3
    try:
        assessment=inspect(token)
        ARTIFACT.write_text(json.dumps(assessment,indent=2,sort_keys=True)+"\n",encoding="utf-8")
        print("Access IdP types (no user details):",assessment["identity_provider_types"])
        print("MFA VERIFIED:",assessment["mfa_cryptographically_verified"],
              "OWNER INTERACTIVE MFA VERIFIED:",assessment["owner_interactive_mfa_verified"],
              "WORKSPACE ENABLED:",assessment["cloud_workspace_enabled"])
        return 0
    except HoldBlocked as error:
        print("ACCESS MFA INVENTORY BLOCKED:",str(error),"NO WRITES")
        return 4


if __name__=="__main__":
    sys.exit(main())
