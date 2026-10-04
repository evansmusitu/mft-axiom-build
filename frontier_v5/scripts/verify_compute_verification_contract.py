from __future__ import annotations
import argparse, importlib, pathlib, sys

CASES=[
 ("numeric.root",{"expression":"x^2-2","symbol":"x","guess":1}),
 ("numeric.integrate",{"expression":"x^2","a":0,"b":1}),
 ("linear.solve",{"A":[[2,0],[0,3]],"b":[4,9]}),
 ("finance.black_scholes",{"S":100,"K":100,"T":1,"r":.05,"sigma":.2,"kind":"call"}),
 ("finance.implied_vol",{"price":10.450583572185565,"S":100,"K":100,"T":1,"r":.05,"kind":"call"}),
 ("optimization.linear_program",{"c":[1.0],"bounds":[[0,2]]}),
 ("optimization.quadratic",{"Q":[[2]],"c":[-4],"bounds":[[0,3]]}),
]
def main():
 ap=argparse.ArgumentParser();ap.add_argument("--runtime",required=True);ns=ap.parse_args()
 sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
 m=importlib.import_module("kernel.app.main")
 failures=[]
 for op,args in CASES:
  off=m.compute(m.ComputeRequest(operation=op,args=args,verify=False))
  on=m.compute(m.ComputeRequest(operation=op,args=args,verify=True))
  if off.get("verified") is not None:failures.append((op,"verify_false_not_none",off.get("verified")))
  v=on.get("verified")
  if not isinstance(v,dict) or v.get("verified") is not True:failures.append((op,"verify_true_not_pass",v))
 # unsupported verifier is explicit not-applicable, not silent null at envelope level.
 ar=m.compute(m.ComputeRequest(operation="arithmetic.evaluate",args={"expression":"40+2"},verify=True))
 if ar.get("verified")!={"verified":None,"method":"not-applicable"}:
  failures.append(("arithmetic.evaluate","not_applicable_contract",ar.get("verified")))
 # Verify true and false must not change the primary result.
 for op,args in CASES:
  off=m.compute(m.ComputeRequest(operation=op,args=args,verify=False))
  on=m.compute(m.ComputeRequest(operation=op,args=args,verify=True))
  if off.get("result_sha256")!=on.get("result_sha256"):
   failures.append((op,"verify_changed_primary_result",(off.get("result_sha256"),on.get("result_sha256"))))
 print("AXIOM_VERIFY_FLAG_SUMMARY="+str({"cases":len(CASES)+1,"failures":failures}))
 if failures:raise SystemExit(1)
 print("MUSITU_AXIOM_VERIFY_FLAG_CONTRACT_PASS")
if __name__=="__main__":raise SystemExit(main())
