from __future__ import annotations
import argparse, hashlib, pathlib

EXPECTED_SHA256="ef3e1a081ad2d68447bbbb0571795d8af9a6ab6a5e72c8e399533250bafb1b13"
OLD="    if isinstance(v,dict): return {k:encode(val) for k,val in v.items()}\n"
NEW="    if isinstance(v,dict): return {str(k):encode(val) for k,val in v.items()}\n"

def main():
    ap=argparse.ArgumentParser();ap.add_argument("path");ns=ap.parse_args()
    p=pathlib.Path(ns.path);raw=p.read_bytes();got=hashlib.sha256(raw).hexdigest()
    if got!=EXPECTED_SHA256:raise SystemExit(f"Fail-closed hardening digest mismatch: {got}")
    s=raw.decode()
    if s.count(OLD)!=1:raise SystemExit("Fail-closed encode dict anchor mismatch")
    p.write_text(s.replace(OLD,NEW,1))
    out=hashlib.sha256(p.read_bytes()).hexdigest()
    print(f"MUSITU_AXIOM_HTTP_SERIALIZATION_PATCH_PASS before={got} after={out}")
if __name__=="__main__":main()
