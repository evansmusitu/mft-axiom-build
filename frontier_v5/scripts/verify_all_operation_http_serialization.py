from __future__ import annotations
import argparse, importlib, json, pathlib, sys

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--runtime",required=True)
    ap.add_argument("--fixtures",required=True)
    ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()))
    m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]
    failed=[]
    for op,args in sorted(fixtures.items()):
        try:
            req=m.ComputeRequest(operation=op,args=args,verify=True)
            out=m.compute(req)
            json.dumps(out,sort_keys=True,separators=(',',':'),allow_nan=False)
        except Exception as e:
            failed.append({"operation":op,"error":type(e).__name__+":"+str(e)})
    print("AXIOM_HTTP_SERIALIZATION_SUMMARY="+json.dumps({"total":len(fixtures),"passed":len(fixtures)-len(failed),"failed":failed},sort_keys=True))
    if failed:
        raise SystemExit(1)
    print("MUSITU_AXIOM_ALL_74_HTTP_SERIALIZATION_PASS")
    return 0
if __name__=="__main__": raise SystemExit(main())
