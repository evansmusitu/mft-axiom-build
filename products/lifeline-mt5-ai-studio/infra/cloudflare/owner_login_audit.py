"""Read-only Access application authentication audit; never print identity or tokens.

An account dashboard sign-in is NOT an LIFELINE Access app login.
A permitted Access log is evidence of Access authorization, NOT proof that a
user's actual browser JWT has been validated by the private edge.
"""
import json,os,urllib.error,urllib.request
from datetime import datetime,timezone,timedelta
ACCOUNT="93f395f5121954671f92fffa453d6b61"
APP="71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
HOST="lifeline-mt5-stage.mftintelligence.com"
BASE="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT
def get(path,token):
    req=urllib.request.Request(BASE+path,headers={"Authorization":"Bearer "+token,
      "Accept":"application/json","User-Agent":"LIFELINE-Login-Audit-Readonly/1"})
    try:
        with urllib.request.urlopen(req,timeout=25) as resp: x=json.load(resp)
        return resp.status if isinstance(x,dict) and x.get("success") is True else 500, x.get("result") if isinstance(x,dict) else None
    except urllib.error.HTTPError as exc:
        return exc.code,None
    except Exception:
        return 0,None
def utcstamp(value):
    if not isinstance(value,str):return None
    try:return datetime.fromisoformat(value.replace("Z","+00:00")).astimezone(timezone.utc)
    except Exception:return None
def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:raise SystemExit("scoped Cloudflare token not configured")
    # Account verification uses the canonical account endpoint.
    req=urllib.request.Request("https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT,
         headers={"Authorization":"Bearer "+token,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=25) as f:row=json.load(f)
    if row.get("success") is not True or row.get("result",{}).get("id")!=ACCOUNT:
        raise SystemExit("Cloudflare account mismatch")
    status,app=get("/access/apps/"+APP,token)
    if status!=200 or not isinstance(app,dict) or app.get("id")!=APP or app.get("domain")!=HOST:
        raise SystemExit("LIFELINE Access app mismatch")
    status,policies=get("/access/apps/"+APP+"/policies?per_page=20",token)
    if status!=200 or not isinstance(policies,list) or len(policies)!=1:
        raise SystemExit("LIFELINE owner Access policy unexpected")
    p=policies[0];mfa=p.get("mfa_config") or {}
    if p.get("decision")!="allow" or mfa.get("mfa_disabled") is not False or mfa.get("session_duration")!="0m":
        raise SystemExit("independent-MFA owner policy not enabled")
    status,users=get("/access/users?per_page=100",token)
    if status!=200 or not isinstance(users,list) or len(users)!=1:
        raise SystemExit("owner Access user identity not unique")
    owner=users[0]
    email=owner.get("email","").strip().lower() if isinstance(owner.get("email"),str) else ""
    if email not in ("evansmusitu5@gmail.com","musituevans@gmail.com"):
        raise SystemExit("owner contact mismatch")
    uid=owner.get("id","")
    if not isinstance(uid,str) or len(uid)!=36:raise SystemExit("owner user ID invalid")
    session_status,sessions=get("/access/users/"+uid+"/active_sessions",token)
    apps=[]
    if session_status==200 and isinstance(sessions,list):
        for s in sessions:
            if not isinstance(s,dict):continue
            meta=s.get("metadata") or {}
            a=meta.get("apps") or {}
            values=a.values() if isinstance(a,dict) else a if isinstance(a,list) else []
            if any(isinstance(z,dict) and (z.get("uid")==APP or z.get("hostname")==HOST) for z in values):
                apps.append(s)
    log_status,events=get("/access/logs/access_requests?per_page=100",token)
    event_list=events if log_status==200 and isinstance(events,list) else []
    # No IP, timestamps, identities, tokens, or raw log payloads printed/stored.
    since=datetime.now(timezone.utc)-timedelta(hours=24)
    ours=[x for x in event_list if isinstance(x,dict) and
          (x.get("app_uid")==APP or x.get("app_domain") in
           (HOST,"https://"+HOST,"https://"+HOST+"/")) and
          (x.get("user_email") or "").strip().lower()==email]
    recent=[x for x in ours if (utcstamp(x.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc))>=since]
    success=[x for x in recent if x.get("allowed") is True]
    denied=[x for x in recent if x.get("allowed") is False]
    res={"schema":"lifeline.owner_app_access_audit.v1",
      "account_pinned":True,"access_app_pinned":True,"one_owner_independent_mfa_policy":True,
      "auth_log_query_http":log_status,"auth_log_readable":log_status==200,
      "latest_100_log_events_inspected":len(event_list),
      "owner_access_audit_window_hours":24,
      "owner_app_recent_authenticated_allow_count":len(success),
      "owner_app_recent_denied_count":len(denied),
      "active_sessions_query_http":session_status,
      "owner_app_session_count":len(apps),
      "recent_owner_app_authorization_evidenced":bool(success),
      "positive_owner_app_session_evidenced":bool(apps),
      "live_owner_jwt_verified_by_worker":False,
      "backend_connected":False,"secrets_exposed":False,"changes_made":False}
    print(json.dumps(res,sort_keys=True))
if __name__=="__main__":main()
