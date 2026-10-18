"""Live read-only acceptance for the dedicated Studio Worker, Access policy and R2.
Never serialize API secrets, payment data, identities or JWTs.
"""
import json,os,pathlib,urllib.error,urllib.request
AID="93f395f5121954671f92fffa453d6b61"
BASE="https://api.cloudflare.com/client/v4"
NAME="musitu-studio-v02";HOST="studio.mftintelligence.com"
def get(path):
 token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
 if not token:raise RuntimeError("CLOUDFLARE_ACCOUNT_TOKEN_NOT_AVAILABLE")
 req=urllib.request.Request(BASE+path,headers={"Authorization":"Bearer "+token,"Accept":"application/json"},method="GET")
 try:
  with urllib.request.urlopen(req,timeout=28) as response:
   value=json.load(response)
   if not isinstance(value,dict) or value.get("success") is not True:
    raise RuntimeError("CLOUDFLARE_READ_REJECTED")
   return value.get("result")
 except urllib.error.HTTPError as e:
  raise RuntimeError("CLOUDFLARE_READ_HTTP_"+str(e.code)) from None
def main():
 out={"schema":"musitu.studio.live-cpu-worker-acceptance.v1","read_only":True,
   "existing_axiom_resources_mutated":False,"worker":NAME,
   "custom_hostname":HOST,"external_browser_access_verification":"NOT_YET_VERIFIED_REQUIRES_REAL_STAFF_ANDROID_BROWSER_SESSION",
   "live_cloudflare_modal_cpu_job_via_browser_verified":False}
 settings=get(f"/accounts/{AID}/workers/scripts/{NAME}/settings")
 bindings=settings.get("bindings") if isinstance(settings,dict) else None
 if not isinstance(bindings,list):raise RuntimeError("WORKER_SETTINGS_BINDINGS_NOT_READABLE")
 basic={x.get("name"):x.get("text") for x in bindings if isinstance(x,dict) and x.get("type")=="plain_text"}
 r2=[x for x in bindings if isinstance(x,dict) and x.get("type")=="r2_bucket" and x.get("name")=="STUDIO_ASSETS"]
 out["worker_settings_readback"]=True
 out["dispatch_approved"]=basic.get("ENABLE_RENDER_DISPATCH")=="true"
 out["billing_gate_approved"]=basic.get("BUDGET_GUARD_APPROVED")=="true"
 out["gpu_gate_closed"]=basic.get("GPU_EXECUTION_APPROVED")=="false"
 out["signed_staff_session_enabled"]=basic.get("STUDIO_SESSION_ENABLED")=="true"
 out["local_test_bypass_disabled"]="STUDIO_LOCAL_TEST_ONLY" not in basic
 out["dedicated_r2_binding"]=len(r2)==1 and r2[0].get("bucket_name")=="musitu-studio-v02-assets"
 out["d1_database_bound"]=any(isinstance(x,dict) and x.get("type")=="d1" for x in bindings)
 out["browser_staff_access_aud_configured"]=isinstance(basic.get("STUDIO_ACCESS_POLICY_AUD"),str) and len(basic.get("STUDIO_ACCESS_POLICY_AUD"))==64
 out["modal_destination_configured"]=isinstance(basic.get("STUDIO_MODAL_URL"),str) and basic.get("STUDIO_MODAL_URL","").endswith(".modal.run/jobs")
 app_list=get(f"/accounts/{AID}/access/apps?per_page=100")
 matches=[x for x in app_list if isinstance(x,dict) and x.get("domain")==HOST]
 out["isolated_access_app"]=len(matches)==1 and matches[0].get("name")=="MUSITU Studio Android Control"
 if out["isolated_access_app"]:
  policy=get(f"/accounts/{AID}/access/apps/{matches[0]['id']}/policies")
  if isinstance(policy,list):
   allows=[p for p in policy if isinstance(p,dict) and p.get("decision")=="allow"]
   out["access_email_only_allow_rules"]=bool(allows) and all(
      p.get("include") and all(isinstance(rule,dict) and list(rule)==["email"] for rule in p["include"])
      for p in allows)
  else:out["access_email_only_allow_rules"]=False
 domains=get(f"/accounts/{AID}/workers/domains")
 out["isolated_hostname_bound"]=any(d.get("hostname")==HOST and d.get("service")==NAME for d in domains if isinstance(d,dict))
 deployments=get(f"/accounts/{AID}/workers/scripts/{NAME}/deployments")
 out["live_worker_deployment_present"]=bool(deployments)
 required=["worker_settings_readback","dispatch_approved","billing_gate_approved","gpu_gate_closed",
 "signed_staff_session_enabled","local_test_bypass_disabled","dedicated_r2_binding",
 "browser_staff_access_aud_configured","modal_destination_configured",
 "isolated_access_app","isolated_hostname_bound","live_worker_deployment_present"]
 out["checks_met"]={key:out.get(key,False) for key in required}
 out["production_configuration_readback_pass"]=all(out["checks_met"].values())
 pathlib.Path("studio-live-cpu-acceptance.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
 print("STUDIO_CPU_LIVE_CLOUDFLARE_CONFIGURATION="+json.dumps(out,sort_keys=True))
 if not out["production_configuration_readback_pass"]:
  raise RuntimeError("STUDIO_LIVE_CPU_CONFIGURATION_FAILED")
if __name__=="__main__":main()
