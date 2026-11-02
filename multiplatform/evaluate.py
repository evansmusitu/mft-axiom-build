from __future__ import annotations
import hashlib,json,math
from pathlib import Path

def wilson(k:int,n:int,z:float=1.959963984540054):
    if n<=0:return [None,None]
    p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*math.sqrt(max(0,p*(1-p))/n+z*z/(4*n*n))/d
    return [c-h,c+h]

def main():
    path=Path("multiplatform/cases/cases.jsonl"); blob=path.read_bytes()
    rows=[json.loads(line) for line in blob.decode().splitlines() if line.strip()]
    print(json.dumps({"schema":"musitu.axiom.sealed-cases.v1","case_count":len(rows),"cases_sha256":hashlib.sha256(blob).hexdigest(),"statistical_method":"Wilson 95% CI for binary pass rate"},sort_keys=True))
if __name__=="__main__":main()
