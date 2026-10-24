"""Read-only Access application sign-in evidence and guest response classifier.
Do not expose user identity, emails, IPs, cookies, JWTs or session handles.
"""
import json,os,urllib.request,urllib.error
ACCOUNT="93f395f5121954671f92fffa453d6b61"
APP="71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
HOST="lifeline-mt5-stage.mftintelligence.com"
BASE="https://api.cloudflare.com/client/v4"
def get(path,token):
    req=urllib.request.Request(BASE+path,headers={"Authorization":"Bearer "+token,
        "Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=25) as f:response=json.load(f)
    if response.get("success") is not True:raise RuntimeError("Access API unsuccessful")
    return response.get("result")
def classify(path):
    class No(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):return None
    client=urllib.request.build_opener(urllib.request.ProxyHandler({}),No())
    req=urllib.request.Request("https://"+HOST+path,headers={
         "User-Agent":"LIFELINE-Guest-Classification/1",
         "Accept":"text/html"})
    try:
        with client.open(req,timeout=20) as resp:
            status=resp.status;head=resp.headers;raw=resp.read(8192)
    except urllib.error.HTTPError as e:
        status=e.code;head=e.headers;raw=e.read(8192)
    except Exception:
        return {"http":0,"network_unavailable":True}
    body=raw.decode("utf-8","ignore").lower()
    location=head.get("Location","")
    return {"http":status,"server_cloudflare":str(head.get("Server","")).lower()=="cloudflare",
        "is_access_login_redirect":"/cdn-cgi/access" in location or ".cloudflareaccess.com" in location,
        "body_access_challenge_marker":any(x in body for x in
           ("cloudflare access","access denied","error 1020","forbidden","login")),
        "body_worker_config_marker":"not_configured" in body,
        "cf_mitigated_present":bool(head.get("Cf-Mitigated"))}
def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:raise RuntimeError("Cloudflare token unavailable")
    users=get("/accounts/"+ACCOUNT+"/access/users?per_page=100",token)
    if not isinstance(users,list) or len(users)!=1:raise RuntimeError("single known owner not found")
    user=users[0]
    if user.get("email","").lower() not in ("evansmusitu5@gmail.com","musituevans@gmail.com"):
        raise RuntimeError("known owner identity mismatch")
    uid=user.get("id")
    if not isinstance(uid,str) or len(uid)!=36:raise RuntimeError("unqualified user ID")
    sessions=get("/accounts/"+ACCOUNT+"/access/users/"+uid+"/active_sessions",token)
    objs=sessions if isinstance(sessions,list) else []
    app_sessions=0
    for x in objs:
        if not isinstance(x,dict):continue
        meta=x.get("metadata") or {}
        apps=meta.get("apps") or {}
        vals=apps.values() if isinstance(apps,dict) else apps if isinstance(apps,list) else []
        if any(isinstance(y,dict) and
           (y.get("hostname")==HOST or y.get("uid")==APP or y.get("name")=="LIFELINE MT5 PRIVATE ACCESS STAGE")
           for y in vals):
            app_sessions+=1
    app=get("/accounts/"+ACCOUNT+"/access/apps/"+APP,token)
    if app.get("domain")!=HOST:raise RuntimeError("Access app changed")
    policies=get("/accounts/"+ACCOUNT+"/access/apps/"+APP+"/policies?per_page=20",token)
    if not isinstance(policies,list) or len(policies)!=1 or policies[0].get("decision")!="allow":
        raise RuntimeError("owner-only Access rule changed")
    mfa=policies[0].get("mfa_config") or {}
    if mfa.get("mfa_disabled") is not False or mfa.get("session_duration")!="0m":
        raise RuntimeError("Access app owner MFA changed")
    result={"schema":"lifeline.owner_positive_access_readonly.v1",
        "hostname":HOST,"only_owner_mfa_policy":True,"app_sessions_detected":app_sessions,
        "owner_access_app_session_positive_evidenced":app_sessions>0,
        "guest_root":classify("/"),
        "guest_login_endpoint":classify("/cdn-cgi/access/login"),
        "owner_credentials_exposed":False,"policy_changes":False}
    print(json.dumps(result,sort_keys=True))
if __name__=="__main__":main()
