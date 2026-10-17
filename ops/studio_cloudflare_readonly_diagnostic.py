"""Cloudflare status-only GET diagnostic for Studio. Sanitized. No mutations or key output."""
import json, os, pathlib, urllib.request, urllib.error
BASE="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
ZONE="mftintelligence.com"
QUERIES=[
  ("user","/user"),
  ("zone","/zones?name="+ZONE+"&status=active"),
  ("account","/accounts/"+ACCOUNT),
  ("d1","/accounts/"+ACCOUNT+"/d1/database?per_page=100"),
  ("r2","/accounts/"+ACCOUNT+"/r2/buckets")
]
def run():
  methods={}
  email=os.getenv("CLOUDFLARE_EMAIL")
  key=os.getenv("CLOUDFLARE_GLOBAL_API_KEY")
  bearer=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN") or os.getenv("CLOUDFLARE_TOKEN")
  if email and key: methods["legacy_global_key"]={"X-Auth-Email":email,"X-Auth-Key":key}
  if bearer: methods["scoped_api_token"]={"Authorization":"Bearer "+bearer}
  result={"schema":"musitu.studio.cloudflare-status-diagnostic.v1",
    "read_only":True,"provider_mutations":False,"billing_verification":"NOT_ESTABLISHED",
    "authentication_methods_available":sorted(methods),
    "checks":{}}
  for mode,auth in methods.items():
    state={}
    for name,path in QUERIES:
      request=urllib.request.Request(BASE+path,headers={**auth,"Accept":"application/json"},method="GET")
      try:
        with urllib.request.urlopen(request,timeout=20) as response:
          code=response.status
          body=json.load(response)
      except urllib.error.HTTPError as e:
        code=e.code;body=None
      except (OSError,ValueError):
        code=0;body=None
      v={"http_status":code,"success":isinstance(body,dict) and body.get("success") is True}
      if v["success"] and name=="zone":
        zones=body.get("result") or []
        v["known_zone_present"]=any(
          isinstance(z,dict) and z.get("name")==ZONE and
          (z.get("account") or {}).get("id")==ACCOUNT for z in zones)
      if v["success"] and name=="account":
        v["expected_account_verified"]=(body.get("result") or {}).get("id")==ACCOUNT
      if v["success"] and name=="d1":
        data=body.get("result") or []
        if isinstance(data,list):
          v["studio_d1_exists_on_first_page"]=any(
            isinstance(x,dict) and x.get("name")=="musitu-studio-v02" for x in data)
      if v["success"] and name=="r2":
        data=body.get("result") or {}
        buckets=data.get("buckets",[]) if isinstance(data,dict) else []
        v["studio_r2_exists_on_first_page"]=any(
          isinstance(x,dict) and x.get("name")=="musitu-studio-v02-assets" for x in buckets)
      state[name]=v
    result["checks"][mode]=state
  pathlib.Path("studio-cloudflare-connection-diagnostic.json").write_text(
    json.dumps(result,indent=2,sort_keys=True)+"\n")
  print("MUSITU_CF_SANITIZED_READ_ONLY="+json.dumps(result,sort_keys=True))
if __name__=="__main__":run()
