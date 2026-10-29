#!/usr/bin/env python3
import argparse, json, sys
REQUIRED=["functional","security","policy","regression","unseen_eval","provenance"]

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--evidence",required=True)
    a=p.parse_args()
    e=json.load(open(a.evidence,encoding="utf-8"))
    missing=[k for k in REQUIRED if e.get(k)!="PASS"]
    out={"gate":"MUSITU_AXIOM_FRONTIER_PROMOTION","status":"PASS" if not missing else "FAIL","missing_or_failed":missing}
    print(json.dumps(out,indent=2))
    sys.exit(0 if not missing else 2)
if __name__=="__main__":
    main()
