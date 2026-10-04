from __future__ import annotations
import argparse, hashlib, pathlib

EXPECTED_SHA256="76d94b7a65e05a79ca5fec0ecc2341282cc25cbf1a58cf78f08b408a2a4dba21"
OLD="""@app.post('/v1/compute')
def compute(req:ComputeRequest):
    t=time.perf_counter()
    try: result=dispatch(req.operation,req.args,req.precision)
    except Exception as e: raise HTTPException(status_code=422,detail={'error':type(e).__name__,'message':str(e)[:500]})
    out={'ok':True,'kernel_version':VERSION,'operation':req.operation,'result':encode(result),'verified':None,'elapsed_ms':round((time.perf_counter()-t)*1000,3)}
    out['result_sha256']=hashlib.sha256(json.dumps(out['result'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return out
"""
NEW="""@app.post('/v1/compute')
def compute(req:ComputeRequest):
    t=time.perf_counter()
    try:
        result=dispatch(req.operation,req.args,req.precision)
        encoded=encode(result)
        verification=_verify_operation(req.operation,req.args,encoded,req.precision) if req.verify else None
    except Exception as e:
        raise HTTPException(status_code=422,detail={'error':type(e).__name__,'message':str(e)[:500]})
    out={'ok':True,'kernel_version':VERSION,'operation':req.operation,'result':encoded,'verified':verification,'elapsed_ms':round((time.perf_counter()-t)*1000,3)}
    out['result_sha256']=hashlib.sha256(json.dumps(out['result'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return out
"""

def main():
    ap=argparse.ArgumentParser();ap.add_argument("path");ns=ap.parse_args()
    p=pathlib.Path(ns.path);raw=p.read_bytes();got=hashlib.sha256(raw).hexdigest()
    if got!=EXPECTED_SHA256:raise SystemExit(f"Fail-closed mutation-candidate digest mismatch: {got}")
    s=raw.decode()
    if s.count(OLD)!=1:raise SystemExit("Fail-closed compute handler anchor mismatch")
    p.write_text(s.replace(OLD,NEW,1))
    out=hashlib.sha256(p.read_bytes()).hexdigest()
    print(f"MUSITU_AXIOM_VERIFY_FLAG_PATCH_PASS before={got} after={out}")
if __name__=="__main__":main()
