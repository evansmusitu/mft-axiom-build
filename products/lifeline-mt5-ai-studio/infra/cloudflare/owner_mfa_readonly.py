"""Read-only exact-account Cloudflare Access owner-MFA enrollment qualification.
No credential values, email addresses, user IDs or login metadata printed.
Never edits policies, custom domains, DNS, Workers or Access organization.
"""
import json,os,urllib.error,urllib.request
ACCOUNT="93f395f5121954671f92fffa453d6b61"
APP="71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
HOST="lifeline-mt5-stage.mftintelligence.com"
API="https://api.cloudflare.com/client/v4"
def get(path,token):
    req=urllib.request.Request(API+path,headers={"Authorization":"Bearer "+token,
      "Accept":"application/json","User-Agent":"LIFELINE-OwnerMFA-Readonly/1"})
    try:
        with urllib.request.urlopen(req,timeout=25) as result:
            data=json.load(result)
    except urllib.error.HTTPError as exc:
        return {"ok":False,"http":exc.code,"data":None}
    except Exception:
        return {"ok":False,"http":0,"data":None}
    return {"ok":isinstance(data,dict) and data.get("success") is True,
      "http":200,"data":data.get("result") if isinstance(data,dict) else None}
def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:raise SystemExit("working scoped Cloudflare API token absent")
    account=get("/accounts/"+ACCOUNT,token)
    if not account["ok"] or not isinstance(account["data"],dict) or account["data"].get("id")!=ACCOUNT:
        raise SystemExit("exact Cloudflare account not qualified")
    app=get("/accounts/"+ACCOUNT+"/access/apps/"+APP,token)
    if not app["ok"] or not isinstance(app["data"],dict):
        raise SystemExit("isolated Access app not readable")
    data=app["data"]
    if data.get("id")!=APP or data.get("name")!="LIFELINE MT5 PRIVATE ACCESS STAGE" or data.get("domain")!=HOST:
        raise SystemExit("isolated Access app identity mismatch")
    policies=get("/accounts/"+ACCOUNT+"/access/apps/"+APP+"/policies?per_page=100",token)
    if not policies["ok"] or not isinstance(policies["data"],list) or not policies["data"]:
        raise SystemExit("isolated app Access policy readback unavailable")
    all_deny=all(isinstance(p,dict) and p.get("decision")=="deny" for p in policies["data"])
    no_allow=not any(isinstance(p,dict) and p.get("decision") in
                      ("allow","bypass","service_auth") for p in policies["data"])
    if not all_deny or not no_allow:
        raise SystemExit("isolated Access app has unexpected permissive policy")
    everyone=any(isinstance(p,dict) and any(isinstance(x,dict) and "everyone" in x
                for x in p.get("include",[])) for p in policies["data"])
    if not everyone:raise SystemExit("deny everyone policy missing")
    org=get("/accounts/"+ACCOUNT+"/access/organizations",token)
    auth_domain=""
    if org["ok"] and isinstance(org["data"],dict):
        auth_domain=org["data"].get("auth_domain","")
    users=get("/accounts/"+ACCOUNT+"/access/users?per_page=100",token)
    entries=users["data"] if users["ok"] and isinstance(users["data"],list) else []
    # Do not print or artifact any user ID, address, login timestamp, IP or identity.
    recent=sum(bool(x.get("last_successful_login")) for x in entries if isinstance(x,dict))
    sole=entries[0] if len(entries)==1 and isinstance(entries[0],dict) else {}
    identity={"ok":False,"http":0,"data":None}
    sessions={"ok":False,"http":0,"data":None}
    user_id=sole.get("id","")
    if isinstance(user_id,str) and len(user_id)==36:
        identity=get("/accounts/"+ACCOUNT+"/access/users/"+user_id+"/last_seen_identity",token)
        sessions=get("/accounts/"+ACCOUNT+"/access/users/"+user_id+"/active_sessions",token)
    owner_email=(sole.get("email") or "").strip().lower() if isinstance(sole.get("email"),str) else ""
    known_contacts={"evansmusitu5@gmail.com","musituevans@gmail.com"}
    owner_contact_matched=owner_email in known_contacts
    seen=identity["data"] if identity["ok"] and isinstance(identity["data"],dict) else {}
    auth_status=seen.get("auth_status")
    auth_types=seen.get("amr",[])
    # IdP-only logins generally cannot prove Access independent MFA; do not
    # interpret a successful IdP login as MFA qualification.
    independent_mfa_qualified=False
    organization=org["data"] if org["ok"] and isinstance(org["data"],dict) else {}
    possible_mfa_settings={key:organization.get(key) is not None for key in
         ("mfa_config","mfa_settings","mfa")}
    # Cloudflare account-level MFA or successful dashboard login are not adequate
    # evidence of this Access app's owner user + app MFA policy.
    result={"schema":"lifeline.cloudflare_owner_mfa_readonly.v1",
       "account_pinned":True,"app_id":APP,"hostname":HOST,"aud_present":bool(data.get("aud")),
       "readback_policy_deny_everyone":True,
       "app_owner_allow_policy_present":False,
       "access_org_config_readable":org["ok"],
       "access_org_auth_domain_configured":bool(auth_domain),
       "access_users_query_http":users["http"],
       "access_user_records_visible":len(entries),
       "recent_access_users_count":recent,
       "sole_access_user_known_owner_contact":owner_contact_matched,
       "sole_access_user_identity_http":identity["http"],
       "sole_access_user_active_sessions_http":sessions["http"],
       "identity_auth_status_present":isinstance(auth_status,str) and bool(auth_status),
       "identity_mfa_claim_present":isinstance(auth_types,list) and
            any("mfa" in str(x).lower() for x in auth_types),
       "organization_mfa_setting_keys_present":possible_mfa_settings,
       "app_mfa_config_present":bool(data.get("mfa_config")),
       "app_owner_mfa_evidenced":independent_mfa_qualified,
       "owner_access_jwt_subject_evidenced":False,
       "live_cloudflare_route_enabled":False,
       "route_created":False,"secrets_exposed":False,"changes_made":False}
    with open("lifeline-owner-mfa-readback.json","w") as f:json.dump(result,f,indent=2)
    print(json.dumps(result,sort_keys=True))
if __name__=="__main__":main()
