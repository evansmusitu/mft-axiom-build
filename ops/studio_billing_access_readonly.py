"""Inspect only Cloudflare billing API token capability. NEVER assert no-bill from a subscription list.
Only GET endpoints, no transaction, no item metadata or amounts in output.
"""
import json,os,pathlib,urllib.request,urllib.error
AID="93f395f5121954671f92fffa453d6b61"
URL="https://api.cloudflare.com/client/v4/accounts/"+AID+"/subscriptions"
def main():
    token=os.getenv("CLOUDFLARE_API_TOKEN") or os.getenv("CF_API_TOKEN") or os.getenv("CLOUDFLARE_TOKEN")
    report={"schema":"musitu.studio.billing-readonly.v1",
      "read_only":True,"billing_mutated":False,
      "provider_out_of_pocket_zero_cap_verified":False,
      "r2_out_of_pocket_hard_cap_verified":False,
      "modal_hard_cap_verified":False,
      "cloudflare_billing_scope":"NOT_CONFIGURED",
      "subscriptions_inspected":False}
    if token:
        req=urllib.request.Request(URL,method="GET",
          headers={"Authorization":"Bearer "+token,"Accept":"application/json"})
        try:
            with urllib.request.urlopen(req,timeout=18) as r:
                raw=json.load(r); code=r.status
            if code==200 and isinstance(raw,dict) and raw.get("success") is True:
                rows=raw.get("result")
                if isinstance(rows,list):
                    report["cloudflare_billing_scope"]="READ_AUTHORIZED"
                    report["subscriptions_inspected"]=True
                    report["subscription_count"]=len(rows)
                    # No subscription IDs, prices, plan descriptions or invoices are logged.
                else:report["cloudflare_billing_scope"]="UNEXPECTED_RESPONSE"
            else:report["cloudflare_billing_scope"]="API_FAILURE"
        except urllib.error.HTTPError as exc:
            report["cloudflare_billing_scope"]="READ_FORBIDDEN" if exc.code in (401,403) else "API_FAILURE"
        except (OSError,ValueError):
            report["cloudflare_billing_scope"]="CANNOT_VERIFY"
    file=pathlib.Path("studio-billing-access-readonly.json")
    file.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print("MUSITU_STUDIO_BILLING_ACCESS="+json.dumps(report,sort_keys=True))
if __name__=="__main__":main()
