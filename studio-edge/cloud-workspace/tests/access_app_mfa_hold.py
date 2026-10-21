"""Scoped, one-time independent MFA hardening for DENY-ALL MUSITU Access app.

Never edits organization global MFA, IdPs, login policies, users, DNS or Workers.
The application remains deny-all. Idempotent readback and no retry on error.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from access_hold_bootstrap import ACCOUNT,DOMAIN,HOST,APP_NAME,HoldBlocked,ensure_account,existing_apps,check_deny_all_app,api
from independent_mfa_assessment import read_organization

BASE="https://api.cloudflare.com/client/v4"
OUT=Path("musitu-cloud-workspace-app-mfa-hold.json")
METHODS=["security_key","totp"]
MFA={"allowed_authenticators":METHODS,"mfa_disabled":False,"session_duration":"0m"}
# Determined by read-only exact Cloudflare readback BEFORE allowing a PUT.
EXPECTED_FIELDS={"allow_authenticate_via_warp","allowed_idps","app_launcher_visible",
 "aud","auto_redirect_to_identity","created_at","destinations","domain",
 "eager_redirect_cookie_setting","enable_binding_cookie",
 "http_only_cookie_attribute","id","name","options_preflight_bypass",
 "policies","self_hosted_domains","session_duration","tags","type","uid","updated_at"}
NON_WRITABLE={"aud","id","uid","created_at","updated_at"}
EXTRA_KEYS={"mfa_config"}

def app_and_org(token,opener):
    ensure_account(token,opener)
    rows=existing_apps(token,opener)
    matches=[a for a in rows if isinstance(a,dict) and
             (a.get("domain")==HOST or a.get("name")==APP_NAME)]
    if len(matches)!=1 or matches[0].get("domain")!=HOST or matches[0].get("name")!=APP_NAME:
        raise HoldBlocked("MFA_HOLD_APP_NOT_UNIQUE")
    ident=matches[0].get("id")
    if not isinstance(ident,str):raise HoldBlocked("APP_ID_INVALID")
    obj=api("GET",f"/accounts/{ACCOUNT}/access/apps/{ident}",
            token,opener=opener).get("result")
    check_deny_all_app(obj,token,opener)
    if set(obj.keys()) not in (EXPECTED_FIELDS,EXPECTED_FIELDS|EXTRA_KEYS):
        raise HoldBlocked("UNKNOWN_ACCESS_APP_API_FIELDS")
    if obj.get("policies") not in ([],None):
        raise HoldBlocked("NONEMPTY_HOLD_APP_POLICIES")
    org=read_organization(token,opener)
    org_mfa=org.get("mfa_config") or {}
    allowed=org_mfa.get("allowed_authenticators") if isinstance(org_mfa,dict) else []
    if not isinstance(allowed,list) or not all(m in allowed for m in METHODS):
        raise HoldBlocked("INDEPENDENT_MFA_NOT_ENABLED_AT_ORG")
    return obj

def mfa_update(token,ident,body,opener):
    url=BASE+f"/accounts/{ACCOUNT}/access/apps/{ident}"
    req=urllib.request.Request(url,method="PUT",data=json.dumps(body).encode(),
        headers={"Authorization":"Bearer "+token,"Content-Type":"application/json",
                 "Accept":"application/json"})
    try:
        with opener(req,timeout=20) as response:
            if response.status not in (200,201):raise HoldBlocked("APP_MFA_UPDATE_HTTP")
            raw=response.read(262145)
    except urllib.error.HTTPError as error:
        raise HoldBlocked("APP_MFA_UPDATE_HTTP_"+str(error.code)) from None
    except urllib.error.URLError:
        raise HoldBlocked("APP_MFA_UPDATE_NETWORK") from None
    if len(raw)>262144:raise HoldBlocked("APP_MFA_RESPONSE_OVERSIZE")
    try:data=json.loads(raw)
    except (TypeError,ValueError):raise HoldBlocked("APP_MFA_UPDATE_INVALID_JSON") from None
    if not isinstance(data,dict) or data.get("success") is not True:
        raise HoldBlocked("APP_MFA_UPDATE_REJECTED")
    return data

def harden(token,opener=urllib.request.urlopen):
    obj=app_and_org(token,opener)
    old=obj.get("mfa_config")
    if old==MFA:
        return {"state":"ALREADY_MFA_RESTRICTED","configuration_ready_for_owner_test":True,
                "allow_policies":0,"owner_login_test_passed":False,"user_access_granted":False,
                "organization_mfa_changed":False,"worker_changed":False}
    if old not in (None,{}):
        raise HoldBlocked("MFA_CONFIG_ALREADY_SET_DIFFERENTLY")
    original_id=obj["id"]
    original_aud=obj["aud"]
    body={k:obj[k] for k in EXPECTED_FIELDS-NON_WRITABLE if k in obj}
    body["policies"]=[]
    body["mfa_config"]=MFA
    # Preserve every writable original setting; never send credentials.
    mfa_update(token,original_id,body,opener)
    # After a single PUT, read back exactly one app and zero policies.
    updated=app_and_org(token,opener)
    if updated.get("id")!=original_id or updated.get("aud")!=original_aud:
        raise HoldBlocked("MFA_CHANGE_ALTERED_AUTH_IDENTITY")
    if updated.get("mfa_config")!=MFA:
        raise HoldBlocked("MFA_READBACK_DID_NOT_MATCH")
    for key,value in body.items():
        if key in ("policies","mfa_config"):continue
        if updated.get(key)!=value:raise HoldBlocked("APP_OTHER_CONFIG_CHANGED")
    return {"state":"APP_ONLY_MFA_RESTRICTED","configuration_ready_for_owner_test":True,
            "allow_policies":0,"owner_login_test_passed":False,"user_access_granted":False,
            "organization_mfa_changed":False,"worker_changed":False}

def main():
    if (os.getenv("EXPECTED_ACCOUNT_ID")!=ACCOUNT or
        os.getenv("EXPECTED_DOMAIN")!=DOMAIN or
        os.getenv("MUSITU_ACCESS_MFA_HOLD_INTENT")!="APP_ONLY_MFA_NO_ALLOW"):
        print("BLOCKED: account or app-only MFA intent guard mismatch")
        return 2
    token=os.getenv("CLOUDFLARE_API_TOKEN","")
    if not token:
        print("BLOCKED: Cloudflare token missing")
        return 3
    try:
        outcome=harden(token)
        result={"schema":"musitu.cloud_workspace.app_only_mfa_hold.v1",
                "account_id":ACCOUNT,"hostname":HOST,"workspace_enabled":False,
                "mfa_methods":METHODS,"session_duration":"0m",**outcome}
        OUT.write_text(json.dumps(result,sort_keys=True,indent=2)+"\n",encoding="utf-8")
        print("MUSITU DENY-ALL APP MFA HOLD:",outcome["state"],
              "ZERO ALLOW POLICIES; MFA STILL REQUIRES OWNER INTERACTIVE TEST")
        return 0
    except HoldBlocked as error:
        print("MUSITU APP MFA HOLD BLOCKED:",str(error),"NO AUTOMATIC RETRY")
        return 4

if __name__=="__main__":sys.exit(main())
