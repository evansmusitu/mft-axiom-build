"""Read-only Page Rule headroom before considering exact Studio-only security override."""
import json,os,pathlib,urllib.request,urllib.error
BASE="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
def get(path,token):
 try:
  with urllib.request.urlopen(urllib.request.Request(BASE+path,headers={"Authorization":"Bearer "+token},method="GET"),timeout=22) as r:
   data=json.load(r);return r.status,data.get("result") if data.get("success") else None
 except urllib.error.HTTPError as e:return e.code,None
 except (OSError,ValueError):return 0,None
def main():
 token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
 out={"schema":"musitu.studio.pagerule-capacity.v1","read_only":True,"axiom_rules_modified":False,
      "zone_verified":False,"page_rules_status":"CANNOT_VERIFY","count":None,"studio_count":None}
 if token:
  s,z=get("/zones?name=mftintelligence.com&status=active",token)
  good=[a for a in z if a.get("name")=="mftintelligence.com" and (a.get("account") or {}).get("id")==ACCOUNT] if isinstance(z,list) else []
  if len(good)==1:
   out["zone_verified"]=True
   q,r=get("/zones/"+good[0]["id"]+"/pagerules?per_page=100",token)
   out["page_rules_status"]="AUTHORIZED" if q==200 else "HTTP_"+str(q)
   if isinstance(r,list):
    out["count"]=len(r)
    out["studio_count"]=sum(1 for x in r if "studio.mftintelligence.com" in str(x.get("targets","")) or "studio-callback.mftintelligence.com" in str(x.get("targets","")))
    out["count_disabled"]=sum(1 for x in r if x.get("status")=="disabled")
 pathlib.Path("studio-pagerules-capacity.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
 print("STUDIO_PAGERULE_CAPACITY="+json.dumps(out,sort_keys=True))
if __name__=="__main__":main()
