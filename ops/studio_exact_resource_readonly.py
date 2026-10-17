"""Exact-name Cloudflare Studio D1/R2 readback; API GET only and no raw data output."""
import json,os,pathlib,urllib.request,urllib.error
AID="93f395f5121954671f92fffa453d6b61"
BASE="https://api.cloudflare.com/client/v4/accounts/"+AID
D1="musitu-studio-v02";R2="musitu-studio-v02-assets"
def request(path,token):
  req=urllib.request.Request(BASE+path,method="GET",
    headers={"Authorization":"Bearer "+token,"Accept":"application/json"})
  try:
    with urllib.request.urlopen(req,timeout=20) as r:
      code=r.status;data=json.load(r)
  except urllib.error.HTTPError as e:
    return e.code,None
  except (OSError,ValueError):
    return 0,None
  return code,data if isinstance(data,dict) and data.get("success") else None
def main():
  token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN") or os.getenv("CLOUDFLARE_TOKEN")
  o={"schema":"musitu.studio.exact-resource-readonly.v1","read_only":True,
     "deployment_allowed":False,"billing_hard_cap_verified":False,
     "d1":{"status":"CANNOT_VERIFY"},"r2":{"status":"CANNOT_VERIFY"}}
  if token:
    c,d=request("/d1/database?name="+D1,token)
    if c==200 and isinstance(d,dict):
      rows=d.get("result")
      if isinstance(rows,list):
        o["d1"]={"status":"VERIFIED","exists":any(isinstance(x,dict) and x.get("name")==D1 for x in rows)}
    c,d=request("/r2/buckets?name="+R2,token)
    if c==200 and isinstance(d,dict):
      payload=d.get("result")
      rows=payload.get("buckets",[]) if isinstance(payload,dict) else []
      if isinstance(rows,list):
        o["r2"]={"status":"VERIFIED","exists":any(isinstance(x,dict) and x.get("name")==R2 for x in rows)}
  pathlib.Path("studio-exact-resource-readonly.json").write_text(json.dumps(o,indent=2,sort_keys=True)+"\n")
  print("MUSITU_EXACT_RESOURCE_READONLY="+json.dumps(o,sort_keys=True))
if __name__=="__main__":main()
