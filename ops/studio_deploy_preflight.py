"""Preflight only: Cloudflare Access/DNS permissions before changing anything.
NEVER log IdP emails, Access app IDs, DNS targets or provider tokens.
"""
import json,os,pathlib,urllib.request,urllib.error,subprocess,sys
API="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
HOST="studio.mftintelligence.com"
def get(path,key):
 try:
  req=urllib.request.Request(API+path,method="GET",headers={"Authorization":"Bearer "+key,"Accept":"application/json"})
  with urllib.request.urlopen(req,timeout=20) as r: data=json.load(r)
  return ("OK",data.get("result")) if data.get("success") else ("PROVIDER_ERROR",None)
 except urllib.error.HTTPError as e:return ("HTTP_"+str(e.code),None)
 except (OSError,ValueError):return ("UNAVAILABLE",None)
def main():
 token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
 r={"schema":"musitu.studio.production-preflight.v1","read_only":True,
    "mutated_existing_projects":False,"cloudflare":{},"modal":{}}
 if token:
  for key,path in [
    ("access_apps",f"/accounts/{ACCOUNT}/access/apps?per_page=100"),
    ("workers_subdomain",f"/accounts/{ACCOUNT}/workers/subdomain"),
    ("d1",f"/accounts/{ACCOUNT}/d1/database?name=musitu-studio-v02"),
    ("r2",f"/accounts/{ACCOUNT}/r2/buckets?name=musitu-studio-v02-assets"),
    ("dns",f"/zones?name=mftintelligence.com")]:
   status,records=get(path,token); entry={"status":status}
   if status=="OK":
    if key=="access_apps" and isinstance(records,list):
     entry["count"]=len(records)
     entry["existing_axiom_candidate_count"]=sum(1 for a in records if isinstance(a,dict) and (
        "axiom" in str(a.get("name","")).lower() or "axiom" in str(a.get("domain","")).lower()))
     entry["studio_access_app_exists"]=any(isinstance(a,dict) and a.get("domain")==HOST for a in records)
    if key=="workers_subdomain" and isinstance(records,dict):
     entry["available"]=bool(records.get("subdomain"))
    if key in ("d1","r2"):
     entries=records if isinstance(records,list) else records.get("buckets",[]) if isinstance(records,dict) else []
     expected="musitu-studio-v02" if key=="d1" else "musitu-studio-v02-assets"
     entry["resource_exists"]=any(isinstance(x,dict) and x.get("name")==expected for x in entries)
    if key=="dns" and isinstance(records,list):
     zones=[z for z in records if isinstance(z,dict) and z.get("name")=="mftintelligence.com" and z.get("account",{}).get("id")==ACCOUNT]
     entry["expected_zone_access"]=len(zones)==1
     if len(zones)==1:
      dns,items=get("/zones/"+zones[0]["id"]+"/dns_records?name="+HOST,token)
      entry["studio_hostname_dns_status"]=dns
      if dns=="OK" and isinstance(items,list):entry["studio_hostname_taken"]=len(items)>0
   r["cloudflare"][key]=entry
 if os.getenv("MODAL_TOKEN_ID") and os.getenv("MODAL_TOKEN_SECRET"):
  for k,cmd in (("apps",[sys.executable,"-m","modal","app","list","--json"]),("secrets",[sys.executable,"-m","modal","secret","list","--json"])):
   try:
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=30)
    entry={"status":"OK" if p.returncode==0 else "NO_ACCESS"}
    if p.returncode==0:
     data=json.loads(p.stdout)
     rows=data if isinstance(data,list) else data.get("apps",data.get("secrets",[]))
     if isinstance(rows,list):entry["studio_exists"]=any(isinstance(x,dict) and (x.get("name")=="musitu-studio-v02") for x in rows)
    r["modal"][k]=entry
   except (ValueError,OSError,subprocess.TimeoutExpired):r["modal"][k]={"status":"UNAVAILABLE"}
 pathlib.Path("studio-deploy-preflight.json").write_text(json.dumps(r,indent=2,sort_keys=True)+"\n")
 print("STUDIO_LIVE_RESOURCE_PREFLIGHT="+json.dumps(r,sort_keys=True))
if __name__=="__main__":main()
