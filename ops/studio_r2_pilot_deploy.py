"""Build dedicated Studio Cloudflare Worker without changing existing Axiom Workers.
D1 not yet authorized: use fail-closed read-only Worker shell with R2 binding;
no production render jobs can be accepted until a Studio DB binding is installed.
"""
import base64,hashlib,hmac,json,os,pathlib,subprocess,urllib.request,urllib.error
ACCOUNT="93f395f5121954671f92fffa453d6b61"
BASE="https://api.cloudflare.com/client/v4"
ROOT=pathlib.Path(__file__).resolve().parents[1]/"musitu_studio"/"edge"
def get(path):
 token=os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
 if not token:raise RuntimeError("MISSING_CLOUDFLARE_TOKEN")
 req=urllib.request.Request(BASE+path,headers={"Authorization":"Bearer "+token},method="GET")
 try:
  with urllib.request.urlopen(req,timeout=30) as r:
   doc=json.load(r)
   if not doc.get("success"):raise RuntimeError("CF_READ_REJECTED")
   return doc.get("result")
 except urllib.error.HTTPError as e:raise RuntimeError("CF_GET_HTTP_"+str(e.code)) from None
def run(cmd,*,cwd=None,input_text=None):
 p=subprocess.run(cmd,cwd=cwd,text=True,input=input_text,capture_output=True,timeout=300,check=False)
 if p.returncode!=0:
  # Restrict output to status; CLI stderr sometimes contains sensitive account data.
  raise RuntimeError("WORKER_DEPLOY_CLI_FAILED_"+str(p.returncode)+"_"+cmd[2] if len(cmd)>2 else "WORKER_DEPLOY_FAILED")
 return p
def main():
 account=get("/accounts/"+ACCOUNT)
 if account.get("id")!=ACCOUNT:raise RuntimeError("WRONG_CLOUDFLARE_ACCOUNT")
 apps=get(f"/accounts/{ACCOUNT}/access/apps?per_page=100")
 found=[a for a in apps if a.get("domain")=="studio.mftintelligence.com"]
 if len(found)!=1 or found[0].get("name")!="MUSITU Studio Android Control":
  raise RuntimeError("STUDIO_STAFF_ACCESS_APP_NOT_PRESENT")
 audience=found[0].get("aud")
 if not isinstance(audience,str) or len(audience)!=64:raise RuntimeError("STUDIO_ACCESS_AUD_MISSING")
 org=get(f"/accounts/{ACCOUNT}/access/organizations")
 authdomain=str(org.get("auth_domain") or "")
 if not authdomain.endswith(".cloudflareaccess.com"):raise RuntimeError("STUDIO_ACCESS_TEAM_DOMAIN_MISSING")
 bucket=get(f"/accounts/{ACCOUNT}/r2/buckets?name=musitu-studio-v02-assets")
 items=bucket.get("buckets",[]) if isinstance(bucket,dict) else bucket
 if not any(b.get("name")=="musitu-studio-v02-assets" for b in items):
  raise RuntimeError("STUDIO_R2_BUCKET_MISSING")
 sub=get(f"/accounts/{ACCOUNT}/workers/subdomain")
 subdomain=str(sub.get("subdomain") or "")
 if not subdomain:raise RuntimeError("WORKERS_DEV_SUBDOMAIN_MISSING")
 cf=os.environ.get("CLOUDFLARE_API_TOKEN") or os.environ.get("CF_API_TOKEN")
 modal_secret=os.environ.get("MODAL_TOKEN_SECRET")
 if not modal_secret:raise RuntimeError("MODAL_CONTROL_KEY_SOURCE_MISSING")
 master=hashlib.sha256(("MUSITU_STUDIO_V02|"+modal_secret+"|"+cf).encode()).digest()
 def key(label):
  return base64.urlsafe_b64encode(hmac.new(master,label.encode(),hashlib.sha256).digest()).decode().rstrip("=")
 config=json.loads((ROOT/"wrangler.jsonc").read_text())
 if config.get("name")!="musitu-studio-v02":raise RuntimeError("WRONG_WORKER_NAME")
 config.pop("d1_databases",None)
 config["main"]="src/r2_entry.mjs"
 config["workers_dev"]=True
 config["vars"].update({
   "STUDIO_ACCESS_TEAM_DOMAIN":"https://"+authdomain,
   "STUDIO_ACCESS_POLICY_AUD":audience,
   "STUDIO_MODAL_URL":os.environ.get("STUDIO_MODAL_ENDPOINT",""),
   "ENABLE_RENDER_DISPATCH":"false",
   "GPU_EXECUTION_APPROVED":"false",
   "STUDIO_STORAGE_MODE":"R2_CAS_SINGLE_ADMIN"})
 config["vars"].pop("STUDIO_LOCAL_TEST_ONLY",None)
 dest=ROOT/"wrangler.live.ci.json"
 dest.write_text(json.dumps(config,indent=2))
 os.chmod(dest,0o600)
 try:
  run(["npx","wrangler","deploy","--config","wrangler.live.ci.json"],cwd=ROOT)
  secrets={"STUDIO_ADMIN_TOKEN":key("admin"),
    "STUDIO_MODAL_CONTROL_KEY":key("modal-control"),
    "STUDIO_MODAL_CALLBACK_KEY":key("callback")}
  for name,value in secrets.items():
   run(["npx","wrangler","secret","put",name,"--config","wrangler.live.ci.json"],cwd=ROOT,input_text=value+"\n")
  result={"schema":"musitu.studio.cloudflare-worker-r2-pilot.v1",
          "worker":"musitu-studio-v02",
          "workers_dev_url":"https://musitu-studio-v02."+subdomain+".workers.dev",
          "status":"LIVE_R2_CONTROL_GATED",
          "staff_access_app_present":True,
          "access_jwt_required_for_interactive_paths":True,
          "d1_unavailable":True,"r2_cas_backend":True,
          "dispatch_enabled":False,
          "axiom_existing_workers_modified":False}
  domains=get(f"/accounts/{ACCOUNT}/workers/domains")
  if not any(d.get("hostname")=="studio.mftintelligence.com" and d.get("service")=="musitu-studio-v02" for d in domains):
   raise RuntimeError("STUDIO_CUSTOM_DOMAIN_MISSING_AFTER_DEPLOY")
  pathlib.Path("studio-r2-pilot-live.json").write_text(json.dumps(result,indent=2,sort_keys=True)+"\n")
  print("STUDIO_R2_PILOT_LIVE="+json.dumps(result,sort_keys=True))
 finally:
  dest.unlink(missing_ok=True)
if __name__=="__main__":main()
