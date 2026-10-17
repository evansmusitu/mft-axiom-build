"""Attach only the dedicated studio.mftintelligence.com custom domain.
Does not alter existing Axiom domains, routes, DNS or Access policies.
"""
import json,os,pathlib,urllib.request,urllib.error
API="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
WORKER="musitu-studio-v02"
HOST="studio.mftintelligence.com"
def call(method,path,body=None):
    token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
    if not token:raise RuntimeError("CLOUDFLARE_SCOPED_TOKEN_MISSING")
    req=urllib.request.Request(API+path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization":"Bearer "+token,"Accept":"application/json","Content-Type":"application/json"},
        method=method)
    try:
        with urllib.request.urlopen(req,timeout=40) as response:
            doc=json.load(response)
            if not doc.get("success"):raise RuntimeError("CF_"+method+"_UNSUCCESSFUL")
            return doc.get("result")
    except urllib.error.HTTPError as exc:
        raise RuntimeError("CF_"+method+"_HTTP_"+str(exc.code)) from None
def main():
    account=call("GET","/accounts/"+ACCOUNT)
    if account.get("id")!=ACCOUNT:raise RuntimeError("ACCOUNT_MISMATCH")
    zones=call("GET","/zones?name=mftintelligence.com&status=active")
    verified=[z for z in zones if z.get("name")=="mftintelligence.com" and z.get("account",{}).get("id")==ACCOUNT]
    if len(verified)!=1:raise RuntimeError("ZONE_IDENTITY_MISMATCH")
    zone=verified[0]["id"]
    applications=call("GET",f"/accounts/{ACCOUNT}/access/apps?per_page=100")
    matches=[a for a in applications if a.get("domain")==HOST and a.get("name")=="MUSITU Studio Android Control"]
    if len(matches)!=1:raise RuntimeError("STAFF_ONLY_STUDIO_ACCESS_MISSING")
    records=call("GET",f"/zones/{zone}/dns_records?name={HOST}")
    domains=call("GET",f"/accounts/{ACCOUNT}/workers/domains")
    owned=[d for d in domains if d.get("hostname")==HOST]
    if len(owned)>1:raise RuntimeError("DUPLICATE_WORKER_DOMAIN")
    if owned and owned[0].get("service")!=WORKER:raise RuntimeError("DOMAIN_OWNED_BY_ANOTHER_WORKER")
    if not owned:
        if records:raise RuntimeError("EXISTING_DNS_RECORD_MUST_NOT_OVERWRITE")
        call("PUT",f"/accounts/{ACCOUNT}/workers/domains",
             {"hostname":HOST,"service":WORKER,"zone_id":zone})
    verified_domains=call("GET",f"/accounts/{ACCOUNT}/workers/domains")
    confirmed=[d for d in verified_domains if d.get("hostname")==HOST and d.get("service")==WORKER]
    if len(confirmed)!=1:raise RuntimeError("STUDIO_DOMAIN_READBACK_FAILED")
    output={"schema":"musitu.studio.hostname-live.v1","hostname":HOST,"studio_worker":WORKER,
      "studio_access_app_verified":True,"custom_domain_attached":True,
      "other_workers_modified":False}
    pathlib.Path("studio-hostname.json").write_text(json.dumps(output,indent=2,sort_keys=True)+"\n")
    print("STUDIO_CUSTOM_DOMAIN_READBACK="+json.dumps(output,sort_keys=True))
if __name__=="__main__":main()
