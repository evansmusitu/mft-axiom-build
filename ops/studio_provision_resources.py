"""Provision isolated MUSITU Studio D1 and R2 in already verified Axiom Cloudflare account.
Existing Axiom resources are never mutated. Refuse account mismatch or name collisions.
"""
import json,os,pathlib,urllib.request,urllib.error
API="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
NAME="musitu-studio-v02"
BUCKET=NAME+"-assets"
def call(method,path,body=None):
  methods=[]
  for k in ("CLOUDFLARE_API_TOKEN","CF_API_TOKEN","CLOUDFLARE_TOKEN",
            "CLOUDFLARE_DEPLOY_TOKEN","CLOUDFLARE_WORKERS_TOKEN","CF_WORKERS_TOKEN"):
    v=os.environ.get(k)
    if v and v not in [t[1] for t in methods]:methods.append((k,v))
  legacy=os.environ.get("CLOUDFLARE_GLOBAL_API_KEY")
  email=os.environ.get("CLOUDFLARE_EMAIL")
  if not methods and not (legacy and email):raise RuntimeError("CLOUDFLARE_PROVIDER_CREDENTIALS_MISSING")
  last_error="NO_AUTHORIZED_CREDENTIAL"
  for kind,value in methods+[("LEGACY_GLOBAL_API_KEY",legacy)] if legacy and email else methods:
    headers={"Content-Type":"application/json","Accept":"application/json"}
    if kind=="LEGACY_GLOBAL_API_KEY":
      headers.update({"X-Auth-Email":email,"X-Auth-Key":value})
    else:headers["Authorization"]="Bearer "+value
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(API+path,data=data,method=method,headers=headers)
    try:
      with urllib.request.urlopen(req,timeout=40) as r:
        response=json.load(r)
        if not response.get("success"):raise RuntimeError("CLOUDFLARE_"+method+"_REJECTED")
        return response.get("result")
    except urllib.error.HTTPError as exc:
      last_error="CLOUDFLARE_"+method+"_HTTP_"+str(exc.code)
      if exc.code in (401,403):continue
      raise RuntimeError(last_error) from None
  raise RuntimeError(last_error)

def main():
  acc=call("GET","/accounts/"+ACCOUNT)
  if acc.get("id")!=ACCOUNT:raise RuntimeError("CLOUDFLARE_ACCOUNT_MISMATCH")
  database=call("GET",f"/accounts/{ACCOUNT}/d1/database?per_page=100")
  if not isinstance(database,list):raise RuntimeError("UNKNOWN_D1_LIST_RESPONSE")
  names=[x for x in database if x.get("name")==NAME]
  if len(names)>1:raise RuntimeError("DUPLICATE_STUDIO_DATABASE_NAME")
  created=[]
  if not names:
    obj=call("POST",f"/accounts/{ACCOUNT}/d1/database",{"name":NAME})
    created.append("STUDIO_D1")
    names=[obj]
  dbid=names[0].get("uuid") or names[0].get("id")
  if not dbid:raise RuntimeError("STUDIO_D1_ID_NOT_FOUND")
  storage=call("GET",f"/accounts/{ACCOUNT}/r2/buckets?per_page=100")
  buckets=storage.get("buckets",[]) if isinstance(storage,dict) else storage
  if not isinstance(buckets,list):raise RuntimeError("UNKNOWN_R2_LIST_RESPONSE")
  matches=[x for x in buckets if x.get("name")==BUCKET]
  if len(matches)>1:raise RuntimeError("DUPLICATE_STUDIO_BUCKET_NAME")
  if not matches:
    call("POST",f"/accounts/{ACCOUNT}/r2/buckets",{"name":BUCKET})
    created.append("STUDIO_R2")
  d1=call("GET",f"/accounts/{ACCOUNT}/d1/database/{dbid}")
  if d1.get("name")!=NAME:raise RuntimeError("STUDIO_DATABASE_READBACK_MISMATCH")
  storage=call("GET",f"/accounts/{ACCOUNT}/r2/buckets?per_page=100")
  buckets=storage.get("buckets",[]) if isinstance(storage,dict) else storage
  if not any(x.get("name")==BUCKET for x in buckets):raise RuntimeError("STUDIO_R2_READBACK_MISMATCH")
  result={"schema":"musitu.studio.cloudflare-resources-live.v1",
          "account_verified":True,"dedicated_d1":NAME,"dedicated_r2":BUCKET,
          "d1_id":dbid,"created_this_run":created,
          "axiom_existing_resources_mutated":False}
  pathlib.Path("studio-resources.json").write_text(json.dumps(result,indent=2,sort_keys=True)+"\n")
  pathlib.Path("studio-d1-id.txt").write_text(dbid+"\n")
  print("STUDIO_CLOUDFLARE_RESOURCES_LIVE="+json.dumps({k:v for k,v in result.items() if k!="d1_id"},sort_keys=True))
if __name__=="__main__":main()
