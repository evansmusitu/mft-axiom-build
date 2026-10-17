"""Live Studio budget boundary inspection: never deploy, run GPU or change billing."""
import json,os,subprocess,sys,urllib.request,urllib.error,pathlib
ACCOUNT="93f395f5121954671f92fffa453d6b61"
def main():
 out={"schema":"musitu.studio.budget_boundary.v1","read_only":True,
      "billing_changes":False,"modal_compute_launched":False,
      "modal_workspace_hard_cap_verified":False,
      "cloudflare_usage_hard_cap_verified":False,
      "zero_out_of_pocket_proven":False,
      "modal_workspace_settings_read":"NOT_CHECKED",
      "cloudflare_subscription_read":"NOT_CHECKED",
      "cloudflare_workers_plan":"UNKNOWN"}
 token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
 if token:
  req=urllib.request.Request("https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/subscriptions",
    headers={"Authorization":"Bearer "+token,"Accept":"application/json"},method="GET")
  try:
   with urllib.request.urlopen(req,timeout=20) as r: data=json.load(r)
   if data.get("success") is True and isinstance(data.get("result"),list):
    out["cloudflare_subscription_read"]="SUCCESS"
    out["subscription_count"]=len(data["result"])
    # Plan classification is informational only and does not establish the R2 overage limit.
    worker_plans=[]
    for row in data["result"]:
     if not isinstance(row,dict):continue
     plan=row.get("rate_plan") or {}
     name=str(plan.get("name") or plan.get("public_name") or "").lower()
     product=str(plan.get("id") or "").lower()
     if "worker" in name or "worker" in product:
      worker_plans.append("PAID" if any(x in name for x in ("paid","bundled","unbound")) else
                          "FREE" if "free" in name else "UNKNOWN")
    if worker_plans:out["cloudflare_workers_plan"]=",".join(sorted(set(worker_plans)))
   else:out["cloudflare_subscription_read"]="UNRECOGNIZED"
  except urllib.error.HTTPError as e:out["cloudflare_subscription_read"]="HTTP_"+str(e.code)
  except (OSError,ValueError):out["cloudflare_subscription_read"]="CANNOT_VERIFY"
 if os.getenv("MODAL_TOKEN_ID") and os.getenv("MODAL_TOKEN_SECRET"):
  try:
   cp=subprocess.run([sys.executable,"-m","modal","workspace","settings","list","--json"],
                     capture_output=True,text=True,timeout=35,check=False)
   if cp.returncode==0:
    obj=json.loads(cp.stdout)
    out["modal_workspace_settings_read"]="SUCCESS"
    # Modal CLI settings currently expose builder defaults, NOT a proved budget cap.
    out["workspace_budget_field_observed"]=("budget" in json.dumps(obj).lower())
   else:out["modal_workspace_settings_read"]="CANNOT_VERIFY"
  except (OSError,ValueError,subprocess.TimeoutExpired):
   out["modal_workspace_settings_read"]="CANNOT_VERIFY"
 pathlib.Path("studio-budget-boundary.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
 print("STUDIO_BUDGET_BOUNDARY="+json.dumps(out,sort_keys=True))
if __name__=="__main__":main()
