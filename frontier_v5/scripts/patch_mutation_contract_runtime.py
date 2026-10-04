from __future__ import annotations
import argparse, hashlib, pathlib

EXPECTED_SHA256="e65e31bb8f15a4c3e7efeb1c56fe49b565aa1cca5c6ffee56f9c1fd24f2d2730"
CODE=r'''
# ---- MUSITU AXIOM MUTATION-GATE CONTRACT HARDENING 20261004 ----
_AXIOM_PRE_MUTATION_VALIDATE=_axiom_validate
def _axiom_validate(op,a):
    _AXIOM_PRE_MUTATION_VALIDATE(op,a)
    if op=='algebra.solve' and 'symbols' in a:
        symbols=a['symbols']
        if not isinstance(symbols,(list,tuple)) or not symbols:
            raise ValueError('symbols must be a non-empty list of names')
        if any(not isinstance(s,str) or not s.strip() for s in symbols):
            raise ValueError('symbols must contain only non-empty strings')
        if len(set(symbols))!=len(symbols):
            raise ValueError('symbols must be unique')
'''

def main():
    ap=argparse.ArgumentParser();ap.add_argument("path");ns=ap.parse_args()
    p=pathlib.Path(ns.path);raw=p.read_bytes();got=hashlib.sha256(raw).hexdigest()
    if got!=EXPECTED_SHA256:raise SystemExit(f"Fail-closed final-candidate digest mismatch: {got}")
    s=raw.decode()
    if "MUSITU AXIOM MUTATION-GATE CONTRACT HARDENING 20261004" in s:raise SystemExit("mutation patch already present")
    p.write_text(s+"\n"+CODE+"\n")
    out=hashlib.sha256(p.read_bytes()).hexdigest()
    print(f"MUSITU_AXIOM_MUTATION_CONTRACT_PATCH_PASS before={got} after={out}")
if __name__=="__main__":main()
