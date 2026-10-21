"""MUSITU Access independent-MFA readiness; read-only, account-scoped, sanitized.

Do not configure org-wide MFA, create access policies or enroll users here.
Independent MFA requires organization-enabled authenticators, app enforcement,
and a real interactive positive/negative MFA test before any owner access.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from access_hold_bootstrap import ACCOUNT,DOMAIN,HOST,APP_NAME,HoldBlocked,ensure_account,existing_apps,check_deny_all_app,api

BASE="https://api.cloudflare.com/client/v4"
OUT=Path("musitu-cloud-workspace-independent-mfa-assessment.json")
ALLOWED={"totp","biometrics","security_key"}

def read_organization(token,opener=urllib.request.urlopen):
    path=f"/accounts/{ACCOUNT}/access/organizations"
    req=urllib.request.Request(BASE+path,headers={"Authorization":"Bearer "+token,
                                  "Accept":"application/json"},method="GET")
    try:
        with opener(req,timeout=18) as response:
            if response.status!=200:raise HoldBlocked("ORGANIZATION_READ_FAILED")
            raw=response.read(262145)
    except urllib.error.HTTPError as error:
        raise HoldBlocked("ORGANIZATION_HTTP_"+str(error.code)) from None
    except urllib.error.URLError:
        raise HoldBlocked("ORGANIZATION_NETWORK_UNAVAILABLE") from None
    if len(raw)>262144:raise HoldBlocked("ORGANIZATION_RESPONSE_OVERSIZE")
    try:payload=json.loads(raw)
    except (ValueError,TypeError):raise HoldBlocked("ORGANIZATION_INVALID_JSON") from None
    if not isinstance(payload,dict) or payload.get("success") is not True or not isinstance(payload.get("result"),dict):
        raise HoldBlocked("ORGANIZATION_INVALID_RESPONSE")
    result=payload["result"]
    domain=result.get("auth_domain")
    if not isinstance(domain,str) or not domain.endswith(".cloudflareaccess.com"):
        raise HoldBlocked("ORGANIZATION_TEAM_DOMAIN_UNPROVEN")
    return result

def inspect(token,opener=urllib.request.urlopen):
    ensure_account(token,opener)
    apps=existing_apps(token,opener)
    target=[a for a in apps if isinstance(a,dict) and (a.get("domain")==HOST or a.get("name")==APP_NAME)]
    if len(target)!=1 or target[0].get("name")!=APP_NAME or target[0].get("domain")!=HOST:
        raise HoldBlocked("DENY_ALL_APP_NOT_UNIQUE")
    ident=target[0].get("id")
    if not isinstance(ident,str):raise HoldBlocked("INVALID_ACCESS_APP_ID")
    app=api("GET",f"/accounts/{ACCOUNT}/access/apps/{ident}",token,opener=opener).get("result")
    check_deny_all_app(app,token,opener)
    org=read_organization(token,opener)
    org_cfg=org.get("mfa_config")
    app_cfg=app.get("mfa_config")
    if org_cfg is not None and not isinstance(org_cfg,dict):raise HoldBlocked("UNKNOWN_ORG_MFA_CONFIG")
    if app_cfg is not None and not isinstance(app_cfg,dict):raise HoldBlocked("UNKNOWN_APP_MFA_CONFIG")
    org_cfg=org_cfg or {}
    app_cfg=app_cfg or {}
    raw_allowed=org_cfg.get("allowed_authenticators") or []
    if not isinstance(raw_allowed,list) or any(not isinstance(x,str) for x in raw_allowed):
        raise HoldBlocked("UNEXPECTED_MFA_AUTHENTICATOR_FORMAT")
    allowed=sorted(set(raw_allowed)&ALLOWED)
    app_allowed=app_cfg.get("allowed_authenticators")
    if app_allowed is not None and (not isinstance(app_allowed,list) or
                                    any(not isinstance(x,str) for x in app_allowed)):
        raise HoldBlocked("UNEXPECTED_APP_AUTHENTICATOR_FORMAT")
    app_explicit=app_cfg.get("mfa_disabled") is False
    app_not_exempt=app_cfg.get("mfa_disabled") is not True
    independent_ready=bool(allowed) and app_explicit and app_cfg.get("session_duration")=="0m"
    return {
        "schema":"musitu.cloud_workspace.independent_mfa_assessment.v1",
        "account_id":ACCOUNT,"zone":DOMAIN,"hostname":HOST,
        "access_app_deny_all_maintained":True,
        "access_app_api_field_names":sorted(list(app.keys())),
        "access_mfa_api_field_names":sorted(list(app_cfg.keys())),
        "organization_independent_mfa_allowed_methods":allowed,
        "organization_independent_mfa_available":bool(allowed),
        "organization_global_mfa_required":org.get("mfa_required_for_all_apps") is True,
        "application_explicit_mfa_enforced":app_explicit,
        "application_mfa_not_disabled":app_not_exempt,
        "application_mfa_each_login":app_cfg.get("session_duration")=="0m",
        "application_allowed_authenticator_types":sorted(set(app_allowed or [])&ALLOWED),
        "application_configuration_ready_for_owner_test":independent_ready,
        "owner_interactive_mfa_verified":False,
        "owner_access_allowed":False,
        "workspace_routed":False,"workspace_enabled":False,
        "write_performed":False,
        "notice":"Configuration is not proof of login MFA; private app remains deny-all."
    }

def main():
    if os.getenv("EXPECTED_ACCOUNT_ID")!=ACCOUNT or os.getenv("EXPECTED_DOMAIN")!=DOMAIN:
        print("BLOCKED: wrong Cloudflare account or zone")
        return 2
    token=os.getenv("CLOUDFLARE_API_TOKEN","")
    if not token:
        print("BLOCKED: Cloudflare token unavailable")
        return 3
    try:
        data=inspect(token)
        OUT.write_text(json.dumps(data,sort_keys=True,indent=2)+"\n",encoding="utf-8")
        print("MUSITU independent MFA org methods:",data["organization_independent_mfa_allowed_methods"])
        print("Access app field names (no values):",data["access_app_api_field_names"])
        print("App MFA explicit:",data["application_explicit_mfa_enforced"],
              "Every login:",data["application_mfa_each_login"],
              "Owner interactive MFA:",False,"Writes:",False)
        return 0
    except HoldBlocked as error:
        print("MFA ORGANIZATION READ BLOCKED:",str(error),"NO WRITES")
        return 4

if __name__=="__main__":sys.exit(main())
