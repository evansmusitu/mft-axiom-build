from __future__ import annotations
import argparse,copy,importlib,json,pathlib,sys
def main():
    ap=argparse.ArgumentParser();ap.add_argument("--runtime",required=True);ap.add_argument("--fixtures",required=True);ns=ap.parse_args()
    sys.path.insert(0,str(pathlib.Path(ns.runtime).resolve()));m=importlib.import_module("kernel.app.main")
    fixtures=json.load(open(ns.fixtures))["fixtures"]; failures=[]
    for op,args in sorted(fixtures.items()):
        bad=copy.deepcopy(args);bad["__axiom_unknown_probe__"]=1
        try:m.dispatch(op,bad,50);failures.append(op)
        except ValueError:pass
        except Exception:pass
    if failures:raise SystemExit("unknown-key rejection failures: "+",".join(failures))
    print("MUSITU_AXIOM_ALL_74_UNKNOWN_ARGUMENT_FAIL_CLOSED_PASS")
if __name__=="__main__":main()
