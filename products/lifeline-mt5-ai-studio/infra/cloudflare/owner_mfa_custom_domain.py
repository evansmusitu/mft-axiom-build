"""Attach ONLY LIFELINE isolated Cloudflare Worker custom domain after owner-only MFA.
No Worker secrets, legacy routes, account changes or existing hostname overwrite.
The Worker deliberately returns 503 until separate secure backend pairing.
"""
import json,os,urllib.error,urllib.parse,urllib.request
ACCOUNT="93f395f5121954671f92fffa453d6b61"
APP="71c315f0-3cfa-4217-98f1-e31d9ec8a44b"
HOST="lifeline-mt5-stage.mftintelligence.com"
SCRIPT="lifeline-mt5-edge-isolated"
OWNER_POLICY="LIFELINE Verified Owner MFA - Preenrollment"
API="https://api.cloudflare.com/client/v4"
def api(method,path,token,data=None):
    headers={"Authorization":"Bearer "+token,"Accept":"application/json",
             "User-Agent":"LIFELINE-PrivateCustomDomain/1"}
    raw=None
    if data is not None:
        headers["Content-Type"]="application/json";raw=json.dumps(data,separators=(",",":")).encode()
    req=urllib.request.Request(API+path,headers=headers,method=method,data=raw)
    try:
        with urllib.request.urlopen(req,timeout=35) as f:response=json.load(f)
    except urllib.error.HTTPError as err:
        raise RuntimeError("Cloudflare "+method+" HTTP "+str(err.code)+" rejected") from None
    if not isinstance(response,dict) or response.get("success") is not True:
        raise RuntimeError("Cloudflare API did not acknowledge "+method)
    return response.get("result")
def main():
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if len(token)<20:raise RuntimeError("Cloudflare token unavailable")
    if api("GET","/accounts/"+ACCOUNT,token).get("id")!=ACCOUNT:
        raise RuntimeError("account mismatch")
    zones=api("GET","/zones?name=mftintelligence.com&per_page=5",token)
    if not isinstance(zones,list) or len(zones)!=1 or zones[0].get("account",{}).get("id")!=ACCOUNT:
        raise RuntimeError("zone not uniquely in exact account")
    zone=zones[0]["id"]
    app=api("GET","/accounts/"+ACCOUNT+"/access/apps/"+APP,token)
    if app.get("name")!="LIFELINE MT5 PRIVATE ACCESS STAGE" or app.get("domain")!=HOST:
        raise RuntimeError("Access app hostname mismatch")
    ps=api("GET","/accounts/"+ACCOUNT+"/access/apps/"+APP+"/policies?per_page=100",token)
    if not isinstance(ps,list) or len(ps)!=1 or ps[0].get("decision")!="allow" or ps[0].get("name")!=OWNER_POLICY:
        raise RuntimeError("owner-only Access policy not qualified")
    inc=ps[0].get("include",[])
    if (not isinstance(inc,list) or len(inc)!=1 or not isinstance(inc[0],dict) or
        not isinstance(inc[0].get("email"),dict)):
        raise RuntimeError("non-single owner")
    owner=inc[0]["email"].get("email","").lower()
    if owner not in {"evansmusitu5@gmail.com","musituevans@gmail.com"}:
        raise RuntimeError("Access account not pinned to known owner")
    mfa=ps[0].get("mfa_config") or {}
    if mfa.get("mfa_disabled") is not False or mfa.get("session_duration")!="0m":
        raise RuntimeError("independent owner MFA disabled")
    if not any(x in mfa.get("allowed_authenticators",[]) for x in ("totp","biometrics","security_key")):
        raise RuntimeError("independent MFA method absent")
    scripts=api("GET","/accounts/"+ACCOUNT+"/workers/scripts?per_page=100",token)
    if not isinstance(scripts,list) or not any(x.get("id")==SCRIPT for x in scripts):
        raise RuntimeError("isolated Worker unavailable")
    existing=api("GET","/accounts/"+ACCOUNT+"/workers/domains",token)
    if not isinstance(existing,list):raise RuntimeError("cannot enumerate custom domains")
    matches=[d for d in existing if d.get("hostname")==HOST]
    if len(matches)>1 or any(d.get("service")!=SCRIPT or d.get("zone_id")!=zone for d in matches):
        raise RuntimeError("hostname already belongs to a different Worker")
    action="already_attached"
    if not matches:
        records=api("GET","/zones/"+zone+"/dns_records?name="+HOST+"&per_page=100",token)
        if not isinstance(records,list) or records:
            raise RuntimeError("DNS hostname already in use; refusing takeover")
        # Custom Domains auto-create managed DNS + SSL, no placeholder record.
        result=api("PUT","/accounts/"+ACCOUNT+"/workers/domains",token,
            {"hostname":HOST,"service":SCRIPT,"zone_id":zone,"zone_name":"mftintelligence.com"})
        if not isinstance(result,dict) or result.get("hostname")!=HOST:
            raise RuntimeError("custom domain create returned mismatch")
        action="attached_new_private_worker_custom_domain"
    all_domains=api("GET","/accounts/"+ACCOUNT+"/workers/domains",token)
    matches=[d for d in all_domains if d.get("hostname")==HOST and
        d.get("service")==SCRIPT and d.get("zone_id")==zone]
    if len(matches)!=1:raise RuntimeError("custom domain readback not qualified")
    print(json.dumps({"schema":"lifeline.owner_mfa_custom_domain.v1",
         "account_pinned":True,"zone_verified":True,
         "owner_only_access_policy":True,"independent_mfa_required":True,
         "custom_domain":HOST,"worker_name":SCRIPT,
         "worker_custom_domain_attached":True,"worker_custom_domain_enabled":bool(matches[0].get("enabled")),
         "no_worker_secrets_changed":True,"no_existing_dns_overwritten":True,
         "backend_connected":False,"persistent_windows_host_connected":False,
         "owner_positive_mfa_login_verified":False,"action":action},sort_keys=True))
if __name__=="__main__":main()
