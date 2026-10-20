#!/usr/bin/env python3
"""Read-only, privacy-safe production Studio topology receipt for chat handoff.
No accounts are mutated; raw identities, IPs, cookies, Access redirects or tokens not saved.
"""
import datetime
import json
import os
from pathlib import Path
import re
import urllib.request
import urllib.error

ACCOUNT="93f395f5121954671f92fffa453d6b61"
ORIGIN="https://studio-v03.mftintelligence.com"
PATHS=("/","/studio.js","/api/session","/api/status","/api/projects",
       "/api/jobs","/api/recovery/readiness","/internal/callback")
token=os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
base="https://api.cloudflare.com/client/v4"
report={
    "schema":"musitu.studio.2026-10-20.provider-readonly-topology.v1",
    "read_only":True,
    "checked_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "credentials_exposed":False,
    "staff_emails_or_subjects_exposed":False,
    "raw_redirect_urls_or_cookies_exposed":False,
    "cloudflare_account_mutated":False,
    "studio_v03_mapped_to_dedicated_worker":None,
    "studio_v02_original_worker_preserved":None,
    "v03_access_app_unique":None,
    "v03_exact_email_allow_policies_count":None,
    "v03_access_app_has_no_bypass":None,
    "v03_signed_access_audience_matches_worker":None,
    "v03_sqlite_do_bound":None,
    "v03_studio_r2_bound":None,
    "cpu_dispatch_off":None,
    "budget_gate_off":None,
    "gpu_dispatch_off":None,
    "anonymous_access_first_hop":{},
    "eight_sensitive_routes_access_protected":False,
    "production_zero_overage_modal_budget_verified":False,
    "two_human_acceptance_verified":False,
    "hosted_pitr_provider_restore_verified":False,
    "notes":"These are read-only provider checks; no authenticated staff session, data export or render was performed."
}
def request(path):
    if not token:return None
    req=urllib.request.Request(base+path,
        headers={"Authorization":"Bearer "+token,"Accept":"application/json"},method="GET")
    try:
        with urllib.request.urlopen(req,timeout=18) as response:
            data=json.load(response)
            return data.get("result") if data.get("success") else None
    except (OSError,ValueError,urllib.error.HTTPError):
        return None

domains=request("/accounts/"+ACCOUNT+"/workers/domains")
if isinstance(domains,list):
    def assigned(host,service):
        return len([d for d in domains if isinstance(d,dict) and
                    d.get("hostname")==host and d.get("service")==service])==1
    report["studio_v03_mapped_to_dedicated_worker"]=assigned("studio-v03.mftintelligence.com","musitu-studio-v03-do")
    report["studio_v02_original_worker_preserved"]=assigned("studio.mftintelligence.com","musitu-studio-v02")
settings=request("/accounts/"+ACCOUNT+"/workers/scripts/musitu-studio-v03-do/settings")
variables={}
if isinstance(settings,dict):
    bindings=settings.get("bindings") or []
    variables={b.get("name"):b.get("text") for b in bindings if isinstance(b,dict) and b.get("type")=="plain_text"}
    report["v03_sqlite_do_bound"]=any(b.get("name")=="STUDIO_LEDGER" and b.get("type")=="durable_object_namespace" for b in bindings if isinstance(b,dict))
    report["v03_studio_r2_bound"]=any(b.get("name")=="STUDIO_ASSETS" and b.get("type")=="r2_bucket" for b in bindings if isinstance(b,dict))
    report["cpu_dispatch_off"]=variables.get("ENABLE_RENDER_DISPATCH")=="false"
    report["budget_gate_off"]=variables.get("BUDGET_GUARD_APPROVED")=="false"
    report["gpu_dispatch_off"]=variables.get("GPU_EXECUTION_APPROVED")=="false"
apps=request("/accounts/"+ACCOUNT+"/access/apps?per_page=100")
if isinstance(apps,list):
    exact=[a for a in apps if isinstance(a,dict)
        and a.get("name")=="MUSITU Studio Enterprise V03"
        and a.get("domain")=="studio-v03.mftintelligence.com"
        and a.get("type")=="self_hosted"]
    report["v03_access_app_unique"]=len(exact)==1
    if len(exact)==1:
        app=exact[0]
        report["v03_signed_access_audience_matches_worker"]=bool(
            isinstance(app.get("aud"),str) and
            re.fullmatch("[0-9a-fA-F]{64}",app["aud"]) and
            variables.get("STUDIO_ACCESS_POLICY_AUD")==app["aud"])
        policies=request("/accounts/"+ACCOUNT+"/access/apps/"+app["id"]+"/policies")
        if isinstance(policies,list):
            only_email=lambda p: (p.get("decision")=="allow" and bool(p.get("include"))
               and all(isinstance(x,dict) and set(x)=={"email"} and
                       isinstance(x["email"],dict) and
                       isinstance(x["email"].get("email"),str) and
                       "@" in x["email"]["email"] for x in p["include"]))
            report["v03_exact_email_allow_policies_count"]=sum(only_email(p) for p in policies if isinstance(p,dict))
            report["v03_access_app_has_no_bypass"]=all(p.get("decision") in ("allow","deny") for p in policies if isinstance(p,dict))
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(NoRedirect())
for path in PATHS:
    req=urllib.request.Request(ORIGIN+path,
        headers={"User-Agent":"MUSITU-Studio-ReadOnly-20261020/1"},
        method="GET")
    status=0
    is_login=False
    try:
        try:
            with opener.open(req,timeout=15) as response:
                status=response.status
                location=response.headers.get("Location","")
        except urllib.error.HTTPError as error:
            status=error.code
            location=error.headers.get("Location","")
        is_login=status in (301,302,303,307,308) and (
            "/cdn-cgi/access/login" in location or ".cloudflareaccess.com/" in location)
    except (OSError,TimeoutError):
        status=0
    # Only small categorical outcomes, no raw private Access URL.
    report["anonymous_access_first_hop"][path]={"status":status,"access_redirect":is_login}
report["eight_sensitive_routes_access_protected"]=all(
    r["access_redirect"] for r in report["anonymous_access_first_hop"].values())
report["release_safety_confirmed_read_only"]=all([
    report["studio_v03_mapped_to_dedicated_worker"],
    report["studio_v02_original_worker_preserved"],
    report["v03_access_app_unique"],
    report["v03_access_app_has_no_bypass"],
    report["v03_signed_access_audience_matches_worker"],
    report["v03_sqlite_do_bound"],
    report["v03_studio_r2_bound"],
    report["cpu_dispatch_off"],
    report["budget_gate_off"],
    report["gpu_dispatch_off"],
    report["eight_sensitive_routes_access_protected"]
])
Path("PROVIDER_READONLY_HANDOFF_SNAPSHOT_20261020.json").write_text(
    json.dumps(report,sort_keys=True,indent=2)+"\n")
print("STUDIO_PROVIDER_HANDOFF_SNAPSHOT="+json.dumps({
    "checked_at_utc":report["checked_at_utc"],
    "safe_topology":report["release_safety_confirmed_read_only"],
    "eight_access_redirects":report["eight_sensitive_routes_access_protected"],
    "cpu_off":report["cpu_dispatch_off"],
    "gpu_off":report["gpu_dispatch_off"],
    "no_cloud_writes":True},sort_keys=True))
