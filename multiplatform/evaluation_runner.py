from __future__ import annotations
import argparse,datetime,hashlib,json,math
from pathlib import Path
def canon(v): return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False,default=str)
def digest(v):
    raw=v if isinstance(v,bytes) else canon(v).encode(); return hashlib.sha256(raw).hexdigest()
def wilson(k,n,z=1.959963984540054):
    if n<=0:return [None,None]
    p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*math.sqrt(max(0,p*(1-p))/n+z*z/(4*n*n))/d; return [c-h,c+h]
def build(provider,model,results,cases_path,tools_hash="UNRECORDED",data_hash="UNRECORDED",system_hash="UNRECORDED",constraints=None):
    case_blob=Path(cases_path).read_bytes(); rows=[]
    for row in results:
        item=dict(row); item["evidence_sha256"]=digest(item.get("output")); rows.append(item)
    passed=sum(1 for row in rows if row.get("passed") is True); count=len(rows)
    return {"schema":"musitu.axiom.cross-provider-run.v1","provider":provider,"model":model,"date_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"caseset_sha256":digest(case_blob),"tools_hash":tools_hash,"data_hash":data_hash,"system_instructions_hash":system_hash,"constraints":constraints or {},"case_count":count,"passed":passed,"pass_rate":passed/count if count else None,"pass_rate_ci95":wilson(passed,count),"results":rows,"run_evidence_sha256":digest(rows)}
def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--provider",required=True); ap.add_argument("--model",required=True); ap.add_argument("--cases",default="multiplatform/cases/cases.jsonl"); ap.add_argument("--results",required=True); ap.add_argument("--out",required=True)
    args=ap.parse_args(); results=json.loads(Path(args.results).read_text(encoding="utf-8"))
    if not isinstance(results,list):raise SystemExit("RESULTS_MUST_BE_JSON_ARRAY")
    m=build(args.provider,args.model,results,args.cases); Path(args.out).write_text(json.dumps(m,indent=2,sort_keys=True)); print("MUSITU_AXIOM_CROSS_PROVIDER_MANIFEST_PASS"); print(m["caseset_sha256"]); print(m["run_evidence_sha256"])
if __name__=="__main__":main()
