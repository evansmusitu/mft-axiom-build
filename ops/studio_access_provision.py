"""Create only a new email-restricted Studio Access app cloned from Axiom Support Operations.
Never mutate source Axiom app or create 'everyone' policy. Fail-closed.
"""
import json,os,pathlib,urllib.request,urllib.error
API="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
HOST="studio.mftintelligence.com"
OWNER="MUSITU Axiom Support Operations"
DEST="MUSITU Studio Android Control"
def api(method,path,body=None):
 token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
 if not token:raise RuntimeError("MISSING_SCOPED_ACCESS_API_TOKEN")
 req=urllib.request.Request(API+path,method=method,
   data=None if body is None else json.dumps(body).encode(),
   headers={"Authorization":"Bearer "+token,"Content-Type":"application/json","Accept":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=25) as r:
   doc=json.load(r)
   if not doc.get("success"):raise RuntimeError("ACCESS_API_RESPONSE_FAILURE")
   return doc.get("result")
 except urllib.error.HTTPError as e:raise RuntimeError("ACCESS_"+method+"_HTTP_"+str(e.code)) from None
def main():
 apps=api("GET",f"/accounts/{ACCOUNT}/access/apps?per_page=100")
 existing=[x for x in apps if x.get("domain")==HOST]
 if len(existing)>1:raise RuntimeError("DUPLICATE_STUDIO_ACCESS_APP")
 created=False
 if existing:
  app=existing[0]
  if app.get("name")!=DEST:raise RuntimeError("UNEXPECTED_EXISTING_ACCESS_APP")
 else:
  source=[x for x in apps if x.get("name")==OWNER and x.get("type")=="self_hosted"]
  if len(source)!=1:raise RuntimeError("SAFE_AXIOM_SUPPORT_IDENTITY_SOURCE_MISSING")
  policies=api("GET",f"/accounts/{ACCOUNT}/access/apps/{source[0]['id']}/policies")
  if not isinstance(policies,list) or not policies:raise RuntimeError("NO_SOURCE_ACCESS_POLICIES")
  copies=[]
  for p in policies:
   if p.get("decision")!="allow":continue
   include=p.get("include") or []
   if not include or not all(set(rule)=={"email"} for rule in include if isinstance(rule,dict)):
    continue
   if not all(isinstance(rule,dict) and isinstance(rule.get("email",{}).get("email"),str)
              for rule in include):continue
   copies.append({"name":"MUSITU Studio Staff Access "+str(len(copies)+1),
                  "decision":"allow","include":include,
                  "require":p.get("require") or [],
                  "exclude":p.get("exclude") or []})
  if not copies:raise RuntimeError("NO_EMAIL_ONLY_ALLOW_POLICY_TO_CLONE")
  payload={"name":DEST,"type":"self_hosted","domain":HOST,
           "session_duration":"8h","app_launcher_visible":False,
           "policies":copies}
  if source[0].get("allowed_idps"):payload["allowed_idps"]=source[0]["allowed_idps"]
  app=api("POST",f"/accounts/{ACCOUNT}/access/apps",payload)
  created=True
  if app.get("domain")!=HOST or app.get("name")!=DEST:raise RuntimeError("ACCESS_CREATE_IDENTITY_MISMATCH")
 if not app.get("aud"):raise RuntimeError("ACCESS_AUD_MISSING")
 out={"schema":"musitu.studio.cloudflare-access-provision.v1",
      "studio_hostname":HOST,"created":created,
      "studio_access_app_present":True,
      "authentication_source":OWNER,
      "only_email_include_policies":True,
      "source_axiom_access_modified":False,
      "policy_count":len(app.get("policies") or [])}
 pathlib.Path("studio-access-app.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
 print("STUDIO_CLOUDFLARE_ACCESS_PROVISION="+json.dumps(out,sort_keys=True))
if __name__=="__main__":main()
