"""Status-only Cloudflare Studio 1010 cause inventory. GET calls only.
No emails, IPs, UA strings, rule expressions or auth credentials in receipts.
"""
import json,os,pathlib,re,urllib.request,urllib.error
from datetime import datetime,timezone
BASE="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
def fetch(path,token):
 req=urllib.request.Request(BASE+path,method="GET",headers={"Authorization":"Bearer "+token,"Accept":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=20) as response:
   body=json.load(response)
   return (200,body.get("result") if body.get("success") is True else None)
 except urllib.error.HTTPError as exc:return(exc.code,None)
 except (OSError,ValueError):return(0,None)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,request,fp,code,msg,headers,newurl):
  return None

def probe_public_edge(agent):
 """GET-only first-hop Access vs Cloudflare 1010, without user or response data.

 Cloudflare Ray IDs correlate a denial to its dashboard Security Event;
 they are not an authentication token or a visitor IP address.
 """
 url="https://studio.mftintelligence.com/"
 headers={"Accept":"text/html,application/json"}
 if agent=="chrome":
  headers["User-Agent"]="Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
 else:
  headers["User-Agent"]="MUSITU-Studio-ReadOnly-Edge-Diagnostic/1.0"
 req=urllib.request.Request(url,headers=headers,method="GET")
 status=0;body=b"";response_headers={}
 try:
  with urllib.request.build_opener(NoRedirect()).open(req,timeout=12) as resp:
   status=resp.status;response_headers=resp.headers;body=resp.read(2048)
 except urllib.error.HTTPError as exc:
  status=exc.code;response_headers=exc.headers;body=exc.read(2048)
 except (OSError,ValueError):
  pass
 ray=response_headers.get("CF-Ray","")
 if not re.fullmatch(r"[a-fA-F0-9]{12,32}-[A-Za-z0-9]{2,6}",ray):ray=None
 location=response_headers.get("Location","")
 return {"agent":agent,"status":status,"cf_ray":ray,
   "cloudflare_error_1010":status==403 and bool(re.search(rb"(?:error\s*(?:code)?\s*[:#-]?\s*1010|1010\s*::)",body,re.I)),
   "access_login_redirect":300<=status<400 and "/cdn-cgi/access/" in location,
   "content_type":response_headers.get("Content-Type","").split(";")[0][:48],
   "cf_mitigated":response_headers.get("cf-mitigated","")[:32]}

def main():
 token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
 out={"schema":"musitu.studio.cloudflare-1010-origin-inventory.v1",
      "read_only":True,"all_existing_axiom_rules_unchanged":True,"zone":{"verified":False},
      "checks":{},"probed_at_utc":datetime.now(timezone.utc).isoformat(),
      "public_edge_first_hop":[probe_public_edge("normal"),probe_public_edge("chrome")]}
 if token:
  status,zones=fetch("/zones?name=mftintelligence.com&status=active",token)
  match=[z for z in zones if isinstance(z,dict) and z.get("name")=="mftintelligence.com" and (z.get("account") or {}).get("id")==ACCOUNT] if isinstance(zones,list) else []
  if status==200 and len(match)==1:
   zid=match[0]["id"];out["zone"]["verified"]=True
   paths=[
    ("browser_integrity_setting",f"/zones/{zid}/settings/browser_check"),
    ("security_level",f"/zones/{zid}/settings/security_level"),
    ("user_agent_rules",f"/zones/{zid}/firewall/ua_rules?per_page=100"),
    ("config_ruleset",f"/zones/{zid}/rulesets/phases/http_config_settings/entrypoint"),
    ("custom_firewall",f"/zones/{zid}/rulesets/phases/http_request_firewall_custom/entrypoint"),
    ("account_custom_firewall",f"/accounts/{ACCOUNT}/rulesets/phases/http_request_firewall_custom/entrypoint"),
   ]
   for name,path in paths:
    code,payload=fetch(path,token)
    record={"http_status":code,"readable":code==200}
    if code==200 and name in ("browser_integrity_setting","security_level"):
      record["value"]=(payload or {}).get("value") if isinstance(payload,dict) else "UNRECOGNIZED"
    elif code==200 and name=="user_agent_rules" and isinstance(payload,list):
      active=[r for r in payload if isinstance(r,dict) and not r.get("paused")]
      record["total"]=len(payload)
      record["active"]=len(active)
      record["blocking"]=sum(1 for r in active if r.get("mode")=="block")
    elif code==200 and name in ("config_ruleset","custom_firewall","account_custom_firewall") and isinstance(payload,dict):
      rules=payload.get("rules") or []
      record["rule_count"]=len(rules)
      record["studio_scoped_count"]=sum(1 for r in rules if isinstance(r,dict) and
         ("studio.mftintelligence.com" in str(r.get("expression","")) or
          "studio-callback.mftintelligence.com" in str(r.get("expression",""))))
      if name=="config_ruleset":
       record["studio_callback_bic_off"]=any(isinstance(r,dict) and
           r.get("action")=="set_config" and r.get("action_parameters",{}).get("bic") is False and
           "studio-callback.mftintelligence.com" in str(r.get("expression","")) for r in rules)
    out["checks"][name]=record
 pathlib.Path("studio-cloudflare-1010-cause-readonly.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
 print("STUDIO_CLOUDFLARE_1010_RULE_INVENTORY="+json.dumps(out,sort_keys=True))
if __name__=="__main__":main()
