#!/usr/bin/env python3
import argparse, itertools, json

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--spec", required=True, help='JSON object: {"variables":{"x":[1,2],"y":[3,4]}}')
    p.add_argument("--output", required=True)
    a=p.parse_args()
    spec=json.load(open(a.spec, encoding="utf-8"))
    variables=spec.get("variables",{})
    if not variables:
        raise SystemExit("variables required")
    names=list(variables)
    rows=[dict(zip(names,vals)) for vals in itertools.product(*(variables[n] for n in names))]
    json.dump({"scenario_count":len(rows),"scenarios":rows},open(a.output,"w",encoding="utf-8"),indent=2)
if __name__=="__main__":
    main()
