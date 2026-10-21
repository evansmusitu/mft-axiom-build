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
    # Only inspect users; no identifying usernames/emails emitted.
    recent=sum(bool(x.get("last_successful_login")) for x in entries if isinstance(x,dict))
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
       "app_owner_mfa_evidenced":False,
       "owner_access_jwt_subject_evidenced":False,
       "live_cloudflare_route_enabled":False,
       "route_created":False,"secrets_exposed":False,"changes_made":False}
    with open("lifeline-owner-mfa-readback.json","w") as f:json.dump(result,f,indent=2)
    print(json.dumps(result,sort_keys=True))
if __name__=="__main__":main()
