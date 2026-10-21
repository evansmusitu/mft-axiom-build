"""Create isolated LIFELINE Access application with explicit DENY ALL before any route exists.

GitHub Actions ONLY: uses existing Cloudflare API token from job environment, never prints it.
Zero DNS/Workers/zone modifications; fully fail-closed until authenticated operator enrollment.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
HOST = "lifeline-mt5-stage.mftintelligence.com"
APP = "LIFELINE MT5 PRIVATE ACCESS STAGE"
BASE = "https://api.cloudflare.com/client/v4"

def api(method, path, token, body=None):
    headers={"Authorization":"Bearer "+token,"Accept":"application/json","User-Agent":"LIFELINE-Access-DenyOnly/1"}
    raw=None
    if body is not None:
        raw=json.dumps(body,separators=(",",":")).encode()
        headers["Content-Type"]="application/json"
    req=urllib.request.Request(BASE+path,data=raw,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=35) as resp:
            ans=json.load(resp)
    except urllib.error.HTTPError as exc:
        details={}
        try: details=json.loads(exc.read(2048))
        except Exception: pass
        codes=[{"code":e.get("code"),"message":str(e.get("message",""))[:160]} for e in details.get("errors",[]) if isinstance(e,dict)]
        raise RuntimeError("Cloudflare API rejected "+method+" status "+str(exc.code)+" codes "+json.dumps(codes)) from None
    if not isinstance(ans,dict) or not ans.get("success"):
        raise RuntimeError("Cloudflare did not acknowledge "+method+" (details withheld)")
    return ans.get("result")

def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:
        raise RuntimeError("existing Cloudflare token unavailable")
    acc=api("GET","/accounts/"+ACCOUNT,token)
    if not isinstance(acc,dict) or acc.get("id")!=ACCOUNT:
        raise RuntimeError("Cloudflare exact account mismatch")
    zones=api("GET","/zones?name=mftintelligence.com&per_page=5",token)
    if len(zones)!=1 or zones[0]["account"]["id"]!=ACCOUNT:
        raise RuntimeError("Cloudflare zone ownership mismatch")
    worker=api("GET","/accounts/"+ACCOUNT+"/workers/scripts?per_page=100",token)
    if not isinstance(worker,list) or not any(x.get("id")=="lifeline-mt5-edge-isolated" for x in worker):
        raise RuntimeError("isolated unrouted LIFELINE worker not found; refusing provisioning")
    existing=api("GET","/accounts/"+ACCOUNT+"/access/apps?per_page=100",token)
    if not isinstance(existing,list):
        raise RuntimeError("could not enumerate Access apps")
    app=next((x for x in existing if x.get("name")==APP or x.get("domain")==HOST),None)
    if app:
        if app.get("name")!=APP or app.get("domain")!=HOST:
            raise RuntimeError("Access app name/hostname collision; refusing to overwrite")
        action="readback_only_existing"
    else:
        # The policy intentionally blocks *every* identity; even the owner cannot yet sign in.
        # There are no public DNS routes and no application secrets.
        payload={
            "name":APP,"type":"self_hosted","domain":HOST,
            "destinations":[{"type":"public","uri":HOST}],
            "session_duration":"1h","app_launcher_visible":False,
            "policies":[{
                "name":"LIFELINE owner enrollment pending - deny all",
                "decision":"deny",
                "include":[{"everyone":{}}]
            }],
        }
        app=api("POST","/accounts/"+ACCOUNT+"/access/apps",token,payload)
        action="created_deny_all"
    if not app or not app.get("id") or not app.get("aud"):
        raise RuntimeError("Access app missing ID or AUD; cannot qualify")
    app=api("GET","/accounts/"+ACCOUNT+"/access/apps/"+app["id"],token)
    if app.get("name")!=APP or app.get("domain")!=HOST:
        raise RuntimeError("Access readback differs")
    # Cloudflare includes policies in app detail; ensure none grants access.
    policies=app.get("policies",[])
    if any(x.get("decision") in ("allow","bypass","service_auth") for x in policies):
        raise RuntimeError("Access app unexpectedly has permissive policy; investigate immediately")
    record={"schema":"lifeline.access.stage.deny.v1","account_id":ACCOUNT,"app_id":app["id"],
            "app_aud":app["aud"],"hostname":HOST,"policy":"DENY_ALL_PENDING_OWNER_MFA",
            "action":action,"custom_domain_or_route_added":False,"dns_changed":False,
            "operator_signin_verified":False,"backend_live":False}
    with open("lifeline-access-qualification.json","w") as f:json.dump(record,f,indent=2)
    print(json.dumps(record,sort_keys=True))
if __name__=="__main__":main()
