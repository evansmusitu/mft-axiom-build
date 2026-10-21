"""Provision ONE account-bound LIFELINE owner Access policy requiring independent MFA.
Does NOT remove deny-everyone policy, add route/DNS/Worker secrets, or expose apps.
No user email, ID, secret, session or URL printed.
"""
import json,os,re,urllib.request,urllib.error
ACC="93f395f5121954671f92fffa453d6b61"
APP="71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
HOST="lifeline-mt5-stage.mftintelligence.com"
NAME="LIFELINE Verified Owner MFA - Preenrollment"
API="https://api.cloudflare.com/client/v4"
CONTACTS={"evansmusitu5@gmail.com","musituevans@gmail.com"}

def req(method,path,token,payload=None):
    headers={"Authorization":"Bearer "+token,"Accept":"application/json",
      "User-Agent":"LIFELINE-OwnerPreenrollment/1"}
    raw=None
    if payload is not None:
        headers["Content-Type"]="application/json"
        raw=json.dumps(payload,separators=(",",":")).encode()
    query=urllib.request.Request(API+path,data=raw,method=method,headers=headers)
    try:
        with urllib.request.urlopen(query,timeout=35) as f:response=json.load(f)
    except urllib.error.HTTPError as e:
        # Only public error type & bounded API code; never echo provided payload.
        try:
            data=json.loads(e.read(3000))
            errors=[{"code":str(x.get("code",""))[:24],"message":str(x.get("message",""))[:140]}
                    for x in data.get("errors",[]) if isinstance(x,dict)][:2]
        except Exception:errors=[]
        raise RuntimeError("Cloudflare "+method+" rejected HTTP "+str(e.code)+" "+json.dumps(errors)) from None
    if not isinstance(response,dict) or response.get("success") is not True:
        raise RuntimeError("Cloudflare did not acknowledge "+method)
    return response.get("result")

def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:raise SystemExit("Cloudflare token absent")
    if req("GET","/accounts/"+ACC,token).get("id")!=ACC:
        raise RuntimeError("Account identity mismatch")
    obj=req("GET","/accounts/"+ACC+"/access/apps/"+APP,token)
    if obj.get("name")!="LIFELINE MT5 PRIVATE ACCESS STAGE" or obj.get("domain")!=HOST:
        raise RuntimeError("LIFELINE Access app identity mismatch")
    org=req("GET","/accounts/"+ACC+"/access/organizations",token)
    config=org.get("mfa_config",{}) if isinstance(org,dict) else {}
    permitted=config.get("allowed_authenticators",[]) if isinstance(config,dict) else []
    allowed=[x for x in ("totp","biometrics","security_key") if x in permitted]
    if not allowed or not config.get("session_duration"):
        raise RuntimeError("Independent Access MFA not configured at org level")
    users=req("GET","/accounts/"+ACC+"/access/users?per_page=100",token)
    if not isinstance(users,list) or len(users)!=1:
        raise RuntimeError("Expected a uniquely identified owner Access user")
    user=users[0]
    owner=user.get("email","").strip().lower() if isinstance(user.get("email"),str) else ""
    if owner not in CONTACTS or not user.get("last_successful_login"):
        raise RuntimeError("Known owner has not qualified Access login")
    if not isinstance(user.get("id"),str) or not re.fullmatch(r"[0-9a-fA-F-]{36}",user["id"]):
        raise RuntimeError("Owner user ID invalid")
    identity=req("GET","/accounts/"+ACC+"/access/users/"+user["id"]+"/last_seen_identity",token)
    if not isinstance(identity,dict) or not re.fullmatch(r"[0-9a-fA-F-]{36}",str(identity.get("user_uuid",""))):
        raise RuntimeError("Owner identity UUID unverified")
    path="/accounts/"+ACC+"/access/apps/"+APP+"/policies"
    policies=req("GET",path+"?per_page=100",token)
    if not isinstance(policies,list) or not policies:
        raise RuntimeError("Deny-all Access policy unreadable")
    if any(p.get("decision") not in ("deny","allow") for p in policies):
        raise RuntimeError("Unexpected permissive app policy")
    blocks=[p for p in policies if p.get("decision")=="deny" and any(
        isinstance(x,dict) and "everyone" in x for x in p.get("include",[]))]
    if len(blocks)!=1:raise RuntimeError("Expected exactly one universal denial")
    existing=[p for p in policies if p.get("name")==NAME]
    if len(existing)>1:raise RuntimeError("Multiple owner policies collide")
    if existing:
        action="verified_existing"
    else:
        if len(policies)!=1:raise RuntimeError("Unexpected preexisting app policy")
        payload={
            "name":NAME,"decision":"allow",
            "include":[{"email":{"email":owner}}],
            "precedence":2,
            # Independent Access MFA regardless of organization-wide default.
            "mfa_config":{"mfa_disabled":False,"allowed_authenticators":allowed,
                          "session_duration":"0m"}
        }
        req("POST",path,token,payload)
        action="created_single_owner_mfa_prepolicy"
    actual=req("GET",path+"?per_page=100",token)
    found=[p for p in actual if p.get("name")==NAME]
    if len(found)!=1:raise RuntimeError("Owner policy missing after readback")
    own=found[0]
    inc=own.get("include",[])
    if own.get("decision")!="allow" or len(inc)!=1 or inc[0].get("email",{}).get("email","").lower()!=owner:
        raise RuntimeError("Owner policy not single-user restricted")
    mf=own.get("mfa_config") or {}
    if mf.get("mfa_disabled") is not False or not any(x in mf.get("allowed_authenticators",[]) for x in allowed):
        raise RuntimeError("Owner policy does not require independent MFA")
    blocks=[p for p in actual if p.get("decision")=="deny" and any(
        isinstance(x,dict) and "everyone" in x for x in p.get("include",[]))]
    if len(blocks)!=1:raise RuntimeError("Existing everyone-deny rule unexpectedly removed")
    # Conservatively refuse to remove deny; no DNS route. Access app intentionally
    # cannot serve customer data without owner MFA and separate issuance proof.
    result={"schema":"lifeline.cloudflare_owner_prepolicy.v1",
        "account_pinned":True,"app_id":APP,"owner_identified_from_access_login":True,
        "owner_email_redacted":True,"user_id_redacted":True,
        "single_owner_allow_rule_present":True,
        "independent_mfa_explicitly_required":True,
        "deny_everyone_policy_retained":True,
        "no_worker_route":True,"no_dns_changes":True,
        "no_proxy_tokens_exposed":True,
        "app_owner_positive_jwt_verified":False,
        "action":action}
    print(json.dumps(result,sort_keys=True))
if __name__=="__main__":main()
