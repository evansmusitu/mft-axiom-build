"""NO-WRITE readiness assessment for LIFELINE Cloudflare→Modal gateway.
Never reads, exposes, generates or publishes secret values. It cannot activate
the gateway. A verified Access app policy is NOT proof of a live owner JWT.
"""
import json,os,urllib.error,urllib.request
ACCOUNT="93f395f5121954671f92fffa453d6b61"
APP="71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
HOST="lifeline-mt5-stage.mftintelligence.com"
WORKER="lifeline-mt5-edge-isolated"
BASE="https://api.cloudflare.com/client/v4"
REQUIRED=frozenset(("ACCESS_ISSUER","ACCESS_AUD","ACCESS_OPERATOR_SUB",
         "MODAL_ORIGIN","MODAL_PROXY_KEY","MODAL_PROXY_SECRET",
         "EDGE_SHARED_SECRET","AGENT_ID","AGENT_TENANT","AGENT_HMAC_KEY"))
def api(path,token):
    req=urllib.request.Request(BASE+path,headers={"Authorization":"Bearer "+token,
      "Accept":"application/json","User-Agent":"LIFELINE-BindingPreflight/1"})
    try:
        with urllib.request.urlopen(req,timeout=25) as resp:body=json.load(resp)
    except urllib.error.HTTPError as err:
        return {"http":err.code,"result":None}
    except Exception:
        return {"http":0,"result":None}
    if not isinstance(body,dict) or body.get("success") is not True:
        return {"http":500,"result":None}
    return {"http":200,"result":body.get("result")}
def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:raise RuntimeError("configured Cloudflare API token not available")
    owner=api("/accounts/"+ACCOUNT,token)
    app=api("/accounts/"+ACCOUNT+"/access/apps/"+APP,token)
    policies=api("/accounts/"+ACCOUNT+"/access/apps/"+APP+"/policies?per_page=20",token)
    workers=api("/accounts/"+ACCOUNT+"/workers/scripts?per_page=100",token)
    secrets=api("/accounts/"+ACCOUNT+"/workers/scripts/"+WORKER+"/secrets",token)
    if owner["http"]!=200 or not isinstance(owner["result"],dict) or owner["result"].get("id")!=ACCOUNT:
        raise RuntimeError("Cloudflare account mismatch")
    if app["http"]!=200 or not isinstance(app["result"],dict) or app["result"].get("id")!=APP or app["result"].get("domain")!=HOST:
        raise RuntimeError("isolated app mismatch")
    items=policies["result"]
    if policies["http"]!=200 or not isinstance(items,list) or len(items)!=1 or items[0].get("decision")!="allow":
        raise RuntimeError("only-owner Access policy not verified")
    mfa=items[0].get("mfa_config") or {}
    if mfa.get("mfa_disabled") is not False or mfa.get("session_duration")!="0m":
        raise RuntimeError("independent app MFA requirement absent")
    if workers["http"]!=200 or not isinstance(workers["result"],list) or not any(
            isinstance(w,dict) and w.get("id")==WORKER for w in workers["result"]):
        raise RuntimeError("exact isolated Worker not found")
    listed=secrets["result"] if secrets["http"]==200 and isinstance(secrets["result"],list) else []
    # Only Worker binding NAMES are inspected, not secret values. Even if the
    # Cloudflare response includes a 'text' field, do not emit or persist it.
    names={s.get("name") for s in listed if isinstance(s,dict) and isinstance(s.get("name"),str)}
    bound=REQUIRED & names
    missing=REQUIRED-names
    # Backend activation is deliberately NOT a function of secret presence only.
    # A separate owner session and actual Access JWT must be qualified.
    result={"schema":"lifeline.cloudflare_modal_preflight.v1",
      "account_verified":True,"access_app_pinned":True,"owner_only_independent_mfa_policy":True,
      "isolated_worker_exists":True,"worker_secret_list_http":secrets["http"],
      "worker_secret_bindings_present":len(bound),
      "worker_required_binding_count":len(REQUIRED),
      "worker_required_binding_names_missing":sorted(missing),
      "verified_owner_access_session":False,
      "verified_positive_owner_jwt":False,
      "backend_cutover_allowed":False,
      "backend_activation_attempted":False,
      "secrets_exposed":False,"changes_made":False}
    with open("lifeline-backend-cutover-readiness.json","w") as f:
        json.dump(result,f,indent=2)
    print(json.dumps(result,sort_keys=True))
if __name__=="__main__":main()
