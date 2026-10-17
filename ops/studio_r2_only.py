"""Try only the dedicated MUSITU Studio R2 bucket independently of D1 permissions."""
from studio_provision_resources import call, ACCOUNT, BUCKET
import json,pathlib
def main():
    account=call("GET","/accounts/"+ACCOUNT)
    if account.get("id")!=ACCOUNT:raise RuntimeError("ACCOUNT_MISMATCH")
    result=call("GET",f"/accounts/{ACCOUNT}/r2/buckets?per_page=100")
    buckets=result.get("buckets",[]) if isinstance(result,dict) else result
    found=[r for r in buckets if r.get("name")==BUCKET]
    if len(found)>1:raise RuntimeError("DUPLICATE_BUCKET")
    created=not found
    if created:call("POST",f"/accounts/{ACCOUNT}/r2/buckets",{"name":BUCKET})
    result=call("GET",f"/accounts/{ACCOUNT}/r2/buckets?per_page=100")
    buckets=result.get("buckets",[]) if isinstance(result,dict) else result
    if not any(r.get("name")==BUCKET for r in buckets):raise RuntimeError("R2_READBACK_NOT_VERIFIED")
    result={"schema":"musitu.studio.r2-live.v1","bucket":BUCKET,"present":True,
            "created_this_run":created,"existing_axiom_buckets_changed":False}
    pathlib.Path("studio-r2-only.json").write_text(json.dumps(result,indent=2,sort_keys=True))
    print("STUDIO_R2_LIVE="+json.dumps(result,sort_keys=True))
if __name__=="__main__":main()
