"""Studio-only WAF Security Level skip. No zone-wide setting change."""
import hashlib, json, os, pathlib, urllib.error, urllib.request
from datetime import datetime, timezone
API="https://api.cloudflare.com/client/v4"
ACCOUNT="93f395f5121954671f92fffa453d6b61"
HOST="studio.mftintelligence.com"
WORKER="musitu-studio-v02"
EXPR='(http.host eq "studio.mftintelligence.com")'
DESC="MUSITU Studio Access-gated hostname: skip only Security Level; preserve BIC and WAF"
PATH="studio-scoped-securitylevel-change.json"

def desired_rule():
    return {"action":"skip","action_parameters":{"products":["securityLevel"]},
            "expression":EXPR,"description":DESC,"enabled":True,"logging":{"enabled":True}}

def is_qualified_access(apps,policies,domains,settings):
    matches=[a for a in apps if isinstance(a,dict) and a.get("name")=="MUSITU Studio Android Control" and a.get("domain")==HOST]
    if len(matches)!=1 or matches[0].get("type")!="self_hosted":return False
    allows=[x for x in policies if isinstance(x,dict) and x.get("decision")=="allow"]
    if not allows or any(not isinstance(x,dict) or x.get("decision") not in ("allow","deny") for x in policies):return False
    if not all(x.get("include") and all(isinstance(v,dict) and list(v)==["email"]
        and isinstance(v["email"],dict) and isinstance(v["email"].get("email"),str)
        and "@" in v["email"]["email"] for v in x["include"]) for x in allows):return False
    if not any(isinstance(x,dict) and x.get("hostname")==HOST and x.get("service")==WORKER for x in domains):return False
    bindings=settings.get("bindings") if isinstance(settings,dict) else None
    plain={b.get("name"):b.get("text") for b in (bindings or []) if isinstance(b,dict) and b.get("type")=="plain_text"}
    return (plain.get("STUDIO_SESSION_ENABLED")=="true" and plain.get("GPU_EXECUTION_APPROVED")=="false"
            and isinstance(plain.get("STUDIO_ACCESS_POLICY_AUD"),str) and len(plain["STUDIO_ACCESS_POLICY_AUD"])==64)

def same_existing(before,after):
    fields=("id","action","action_parameters","expression","enabled","logging","description")
    sig=lambda x:hashlib.sha256(json.dumps({k:x.get(k) for k in fields},sort_keys=True).encode()).hexdigest()
    after_ids={r.get("id"):r for r in after if isinstance(r,dict)}
    return all(isinstance(r,dict) and r.get("id") in after_ids and sig(r)==sig(after_ids[r["id"]]) for r in before)

def main():
    record={"schema":"musitu.studio.securitylevel-scoped-skip.v1","scope":HOST,
            "created_at_utc":datetime.now(timezone.utc).isoformat(),
            "global_security_setting_changed":False,"axiom_rules_intentionally_modified":False,
            "bypass_products":["securityLevel"],"browser_integrity_check_preserved":True,
            "access_readback_pass":False,"attempted":False,"created":False,"verified":False,"reason":"not_started"}
    def finish():
        pathlib.Path(PATH).write_text(json.dumps(record,indent=2,sort_keys=True)+"\n")
        print("STUDIO_SECURITYLEVEL_SCOPED_OUTCOME="+json.dumps(record,sort_keys=True))
    token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN")
    if not token:
        record["reason"]="account_credential_unavailable";finish();return
    def call(method,path,payload=None):
        request=urllib.request.Request(API+path,method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
        try:
            with urllib.request.urlopen(request,timeout=22) as resp:
                doc=json.load(resp)
                return resp.status,doc.get("result") if doc.get("success") else None
        except urllib.error.HTTPError as err:return err.code,None
        except (OSError,ValueError):return 0,None
    status,zones=call("GET","/zones?name=mftintelligence.com&status=active")
    matches=[z for z in (zones or []) if isinstance(z,dict) and z.get("name")=="mftintelligence.com"
             and (z.get("account") or {}).get("id")==ACCOUNT]
    if status!=200 or len(matches)!=1:
        record["reason"]="zone_unverified";finish();return
    zone=matches[0]["id"]
    st,settings=call("GET",f"/accounts/{ACCOUNT}/workers/scripts/{WORKER}/settings")
    aa,apps=call("GET",f"/accounts/{ACCOUNT}/access/apps?per_page=100")
    dd,domains=call("GET",f"/accounts/{ACCOUNT}/workers/domains")
    app_matches=[a for a in (apps or []) if isinstance(a,dict) and a.get("domain")==HOST
                 and a.get("name")=="MUSITU Studio Android Control"]
    pp,policies=(0,None)
    if len(app_matches)==1:
        pp,policies=call("GET",f'/accounts/{ACCOUNT}/access/apps/{app_matches[0]["id"]}/policies')
    if not all(code==200 for code in (st,aa,dd,pp)) or not all(isinstance(x,list)
        for x in (apps,domains,policies)) or not is_qualified_access(apps,policies,domains,settings):
        record["reason"]="staff_only_access_not_freshly_verified";finish();return
    record["access_readback_pass"]=True
    ww,waf=call("GET",f"/zones/{zone}/rulesets/phases/http_request_firewall_custom/entrypoint")
    if ww!=200 or not isinstance(waf,dict) or not isinstance(waf.get("rules"),list) or not waf.get("id"):
        record["reason"]="custom_waf_ruleset_unreadable";finish();return
    before=waf["rules"]
    if len(before)>=5:
        record["reason"]="free_waf_custom_rule_slots_exhausted";finish();return
    proposed=desired_rule()
    if any(isinstance(r,dict) and r.get("expression")==EXPR for r in before):
        record["reason"]="existing_studio_expression_requires_review";finish();return
    record["attempted"]=True
    status,_=call("POST",f'/zones/{zone}/rulesets/{waf["id"]}/rules',proposed)
    record["post_status"]=status
    if status not in (200,201):
        record["reason"]="cloudflare_write_permission_or_provider_rejection";finish();return
    rr,now=call("GET",f"/zones/{zone}/rulesets/phases/http_request_firewall_custom/entrypoint")
    if rr==200 and isinstance(now,dict) and isinstance(now.get("rules"),list):
        current=now["rules"]
        found=[r for r in current if isinstance(r,dict) and r.get("expression")==EXPR and r.get("action")=="skip"
               and r.get("action_parameters")=={"products":["securityLevel"]} and r.get("enabled",True)]
        record["created"]=len(found)==1
        record["existing_rules_preserved"]=same_existing(before,current)
        record["verified"]=record["created"] and record["existing_rules_preserved"] and len(current)==len(before)+1
    record["reason"]="scoped_rule_verified" if record["verified"] else "post_mutation_readback_not_verified"
    finish()

if __name__=="__main__":main()
