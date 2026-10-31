"""Activate only verified LIFELINE owner MFA policy. Still NO Worker route.
Access by default denies everyone else. Removes only the old staged universal deny
after checking sole owner allow + independent MFA and matching current user.
No personal data printed or persisted.
"""
import json,os,re,urllib.error,urllib.request
ACCOUNT="93f395f5121954671f92fffa453d6b61"
APP="71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
NAME="LIFELINE Verified Owner MFA - Preenrollment"
HOST="lifeline-mt5-stage.mftintelligence.com"
BASE="https://api.cloudflare.com/client/v4"
KNOWN={"evansmusitu5@gmail.com","musituevans@gmail.com"}
def call(method,path,token):
    req=urllib.request.Request(BASE+path,method=method,headers={
        "Authorization":"Bearer "+token,"Accept":"application/json",
        "User-Agent":"LIFELINE-OwnerOnlyActivation/1"})
    try:
        with urllib.request.urlopen(req,timeout=35) as f:data=json.load(f)
    except urllib.error.HTTPError as exc:
        raise RuntimeError("Cloudflare "+method+" HTTP "+str(exc.code)+" fail closed") from None
    if not isinstance(data,dict) or not data.get("success"):
        raise RuntimeError("Cloudflare "+method+" unacknowledged")
    return data.get("result")
def verify(policies,owner):
    if len(policies)<1 or len(policies)>2:
        raise RuntimeError("unexpected Access policy count")
    allowed=[p for p in policies if p.get("decision")=="allow"]
    if len(allowed)!=1:
        raise RuntimeError("unique allow owner missing")
    policy=allowed[0]
    if policy.get("name")!=NAME:raise RuntimeError("unexpected allow policy")
    inc=policy.get("include")
    if not isinstance(inc,list) or len(inc)!=1 or not isinstance(inc[0],dict):
        raise RuntimeError("owner identity include not unique")
    identity=inc[0].get("email")
    if not isinstance(identity,dict) or identity.get("email","").lower()!=owner:
        raise RuntimeError("owner policy not bound")
    config=policy.get("mfa_config") or {}
    if (config.get("mfa_disabled") is not False or
        config.get("session_duration")!="0m" or
        not isinstance(config.get("allowed_authenticators"),list) or
        not any(k in config["allowed_authenticators"] for k in ("totp","biometrics","security_key"))):
        raise RuntimeError("independent MFA not explicitly enforced")
    if any(p.get("decision") not in ("allow","deny") for p in policies):
        raise RuntimeError("unsafe Access policy decision")
def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:raise RuntimeError("Cloudflare token absent")
    if call("GET","/accounts/"+ACCOUNT,token).get("id")!=ACCOUNT:
        raise RuntimeError("Cloudflare account mismatch")
    app=call("GET","/accounts/"+ACCOUNT+"/access/apps/"+APP,token)
    if app.get("name")!="LIFELINE MT5 PRIVATE ACCESS STAGE" or app.get("domain")!=HOST:
        raise RuntimeError("Access app identity mismatch")
    users=call("GET","/accounts/"+ACCOUNT+"/access/users?per_page=100",token)
    if not isinstance(users,list) or len(users)!=1:
        raise RuntimeError("single known owner required")
    user=users[0]
    owner=user.get("email","").strip().lower()
    if owner not in KNOWN or not user.get("last_successful_login"):
        raise RuntimeError("recent known owner Access login required")
    path="/accounts/"+ACCOUNT+"/access/apps/"+APP+"/policies"
    policies=call("GET",path+"?per_page=100",token)
    verify(policies,owner)
    blockers=[p for p in policies if p.get("decision")=="deny" and
       any(isinstance(x,dict) and "everyone" in x for x in p.get("include",[]))]
    if len(blockers)>1:raise RuntimeError("universal deny collision")
    action="already_owner_only"
    if len(blockers)==1:
        if len(policies)!=2:raise RuntimeError("unexpected policy coexistence")
        entry=blockers[0]
        policy_id=entry.get("id")
        if not isinstance(policy_id,str) or not re.fullmatch(r"[0-9a-fA-F-]{36}",policy_id):
            raise RuntimeError("expected explicit deny ID")
        call("DELETE",path+"/"+policy_id,token)
        action="old_deny_removed_owner_only_mfa_active"
    live=call("GET",path+"?per_page=100",token)
    verify(live,owner)
    if len(live)!=1 or live[0].get("decision")!="allow":
        raise RuntimeError("Access policy not exclusively owner MFA after change")
    # Must not attach custom domain or route here. No internet-facing service yet.
    print(json.dumps({"schema":"lifeline.owner_mfa_policy_activated.v1",
        "account_pinned":True,"known_owner_verified_from_access_users":True,
        "only_one_owner_allowed":True,"explicit_independent_mfa_required":True,
        "other_users_default_denied":True,
        "owner_login_to_lifeline_app_positive_verified":False,
        "no_worker_route_or_dns_created":True,
        "secrets_printed":False,"action":action},sort_keys=True))
if __name__=="__main__":main()
