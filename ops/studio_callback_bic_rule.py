"""Exception scoped to a single authenticated Modal callback route ONLY.
Disable only Cloudflare Browser Integrity Check for the callback; preserve all
existing Axiom rules and every other security feature.
"""
import json,os,pathlib,urllib.request,urllib.error
API="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
ZONE="mftintelligence.com"
HOST="studio-callback.mftintelligence.com"
EXPR='(http.host eq "'+HOST+'" and http.request.method eq "POST" and http.request.uri.path eq "/internal/callback")'
DESC="MUSITU Studio authenticated Modal callback only: bypass BIC, preserve all other protections"
def call(method,path,body=None):
 token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
 if not token:raise RuntimeError("CLOUDFLARE_TOKEN_MISSING")
 req=urllib.request.Request(API+path,data=json.dumps(body).encode() if body is not None else None,method=method,
  headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=35) as resp:
   doc=json.load(resp)
   if not doc.get("success"):raise RuntimeError("CF_UNSUCCESSFUL_"+method)
   return doc.get("result")
 except urllib.error.HTTPError as e:raise RuntimeError("CF_"+method+"_HTTP_"+str(e.code)) from None
def main():
 zones=call("GET","/zones?name="+ZONE+"&status=active")
 selected=[z for z in zones if z.get("name")==ZONE and z.get("account",{}).get("id")==ACCOUNT]
 if len(selected)!=1:raise RuntimeError("WRONG_ZONE")
 zid=selected[0]["id"]
 domains=call("GET",f"/accounts/{ACCOUNT}/workers/domains")
 if not any(d.get("hostname")==HOST and d.get("service")=="musitu-studio-callback-v02" for d in domains):
  raise RuntimeError("STUDIO_CALLBACK_WORKER_DOMAIN_NOT_VERIFIED")
 listed=call("GET",f"/zones/{zid}/rulesets")
 if not isinstance(listed,list):raise RuntimeError("RULESET_LIST_BAD")
 previous=[r for r in listed if r.get("phase")=="http_config_settings" and r.get("kind")=="zone"]
 if len(previous)>1:raise RuntimeError("DUPLICATE_CONFIG_RULESET")
 rule={"action":"set_config","action_parameters":{"bic":False},
       "expression":EXPR,"description":DESC,"enabled":True}
 exists=False
 if previous:
  rid=previous[0]["id"]
  current=call("GET",f"/zones/{zid}/rulesets/{rid}")
  rules=current.get("rules") or []
  safe=[r for r in rules if r.get("expression")==EXPR]
  if len(safe)>1:raise RuntimeError("DUPLICATE_STUDIO_EXCEPTION")
  if safe:
   one=safe[0]
   if one.get("action")!="set_config" or one.get("action_parameters",{}).get("bic") is not False:
    raise RuntimeError("UNSAFE_EXISTING_CALLBACK_RULE")
   exists=True
  if not exists:
   call("POST",f"/zones/{zid}/rulesets/{rid}/rules",rule)
 else:
  created=call("POST",f"/zones/{zid}/rulesets",{
    "name":"MUSITU Studio M2M Callback Configuration",
    "kind":"zone","phase":"http_config_settings","rules":[rule]})
  rid=created.get("id")
 if not rid:raise RuntimeError("RULESET_ID_MISSING")
 readback=call("GET",f"/zones/{zid}/rulesets/{rid}")
 matches=[r for r in readback.get("rules",[]) if r.get("expression")==EXPR and r.get("action_parameters",{}).get("bic") is False]
 if len(matches)!=1:raise RuntimeError("CALLBACK_EXCEPTION_NOT_VERIFIED")
 result={"schema":"musitu.studio.callback-only-bic.v1","hostname":HOST,
         "method":"POST","path":"/internal/callback",
         "browser_integrity_check_disabled_on_callback_only":True,
         "other_security_products_unchanged":True,
         "existing_axiom_rules_preserved":True,
         "created_this_run":not exists}
 pathlib.Path("studio-callback-bic.json").write_text(json.dumps(result,indent=2,sort_keys=True)+"\n")
 print("STUDIO_CALLBACK_ONLY_BIC_RULE="+json.dumps(result,sort_keys=True))
if __name__=="__main__":main()
