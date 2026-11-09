"""Exact one-endpoint Cloudflare subscription read, non-billable and non-mutating.
Do not interpret a subscription label as permission to create a database.
Only sanitized status; no subscription IDs, amounts, contacts or bearer tokens.
"""
import json,os,hashlib,urllib.request,urllib.error
from pathlib import Path

ACCOUNT="93f395f5121954671f92fffa453d6b61"
URL="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT+"/subscriptions"

class Refuse(Exception): pass
class NeverRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**kw):return None

def summarize(obj):
    result={"schema":"AXIOM_PRIMARY_WORKERS_ENTITLEMENT_GET_ONLY_V1",
        "account_id":ACCOUNT,"only_method":"GET","provider_writes":0,
        "cost_changing_operation":False,"identity_database_creation_authorized":False,
        "release_authority":False,"workers_plan_independently_qualified":False}
    if not isinstance(obj,dict) or obj.get("success") is not True or not isinstance(obj.get("result"),list):
        result.update(status="SUBSCRIPTION_READ_UNQUALIFIED",count=None,worker_named_count=None)
        return result
    rows=obj["result"]
    if len(rows)>100 or any(not isinstance(x,dict) for x in rows):
        result.update(status="SUBSCRIPTION_SHAPE_INVALID",count=None,worker_named_count=None)
        return result
    worker_named=[]
    for r in rows:
        rate=r.get("rate_plan")
        if not isinstance(rate,dict):continue
        name=rate.get("public_name")
        if isinstance(name,str) and "workers" in name.casefold():
            worker_named.append(r)
    result.update(status="SUBSCRIPTIONS_READ_NO_CREATE_AUTHORITY",count=len(rows),
        worker_named_count=len(worker_named),workers_paid_subscription_observed=any(
            type(x.get("price")) in (int,float) and x["price"]>0 and
            x.get("state") in ("Paid","Provisioned") for x in worker_named))
    return result

def run(fetch=None):
    token=os.environ.get("CLOUDFLARE_API_TOKEN","")
    if not token or any(c in token for c in "\r\n"):raise Refuse("TOKEN_NOT_AVAILABLE")
    def real_get():
        req=urllib.request.Request(URL,method="GET",
            headers={"Authorization":"Bearer "+token,"Accept":"application/json"})
        try:
            with urllib.request.build_opener(NeverRedirect).open(req,timeout=15) as response:
                if response.status!=200:raise Refuse("BILLING_READ_UNQUALIFIED")
                raw=response.read(90001)
        except urllib.error.HTTPError as e:raise Refuse("BILLING_READ_HTTP_"+str(e.code)) from None
        except (OSError,TimeoutError):raise Refuse("BILLING_READ_NETWORK_UNAVAILABLE") from None
        if len(raw)>90000:raise Refuse("BILLING_RESPONSE_SIZE")
        try:return json.loads(raw.decode("utf-8"))
        except (UnicodeError,ValueError):raise Refuse("BILLING_RESPONSE_INVALID") from None
    try:
        outcome=summarize(fetch() if fetch else real_get())
    except Refuse as e:
        outcome={"schema":"AXIOM_PRIMARY_WORKERS_ENTITLEMENT_GET_ONLY_V1",
            "status":str(e),"only_method":"GET","provider_writes":0,
            "cost_changing_operation":False,"identity_database_creation_authorized":False,
            "release_authority":False,"workers_plan_independently_qualified":False}
    raw=(json.dumps(outcome,sort_keys=True,indent=2)+"\n").encode()
    p=Path("axiom-primary-workers-entitlement-readonly.json")
    p.write_bytes(raw)
    p.with_name(p.name+".sha256").write_text(hashlib.sha256(raw).hexdigest()+"  "+p.name+"\n")
    print("AXIOM_WORKERS_ENTITLEMENT="+outcome["status"]+" CLOUD_WRITES=0")
    return 0 if outcome["status"]=="SUBSCRIPTIONS_READ_NO_CREATE_AUTHORITY" else 2

if __name__=="__main__":
    raise SystemExit(run())
