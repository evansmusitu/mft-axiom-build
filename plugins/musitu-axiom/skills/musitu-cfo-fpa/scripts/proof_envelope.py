#!/usr/bin/env python3
import argparse, json, hashlib, datetime

def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="JSON file containing proof-envelope fields")
    p.add_argument("--output", required=True)
    a=p.parse_args()
    data=json.load(open(a.input, encoding="utf-8"))
    required=["question","evidence","assumptions","method","result"]
    missing=[k for k in required if k not in data]
    if missing:
        raise SystemExit("missing required fields: "+",".join(missing))
    payload=dict(data)
    payload.setdefault("generated_at", datetime.datetime.now(datetime.timezone.utc).isoformat())
    body=canonical(payload)
    payload["reproducibility_fingerprint_sha256"]=hashlib.sha256(body.encode()).hexdigest()
    with open(a.output,"w",encoding="utf-8") as f:
        json.dump(payload,f,indent=2,ensure_ascii=False)
if __name__=="__main__":
    main()
