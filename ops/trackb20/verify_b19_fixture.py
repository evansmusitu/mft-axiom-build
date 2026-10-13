#!/usr/bin/env python3
"""B20 independent audit of immutable B19 native signed public CI evidence.

This verifies causal linkage, signature self-consistency, source commit, exact
observed B12 source hashes and separately published GitHub Actions digest.
It does not authenticate the ephemeral key to an external independent issuer.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path
from causality import verify_linkage, CausalDenied

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE.parent/'trackb19'))
from verify_receipt import run

B19_COMMIT='e95f8ac45e035d102a9a808e6680c8656f1fcdcd'
CI_PORTABLE_SHA256='805769640d8a9690275734baa259c3e8afc6ef656f1699d947166dfdb4d8b3a2'
CI_CHAIN_SHA256='d2bb53dd4a9c1f61f6acb69503c73644786711d1d69e2df4465228872c7e91de'
B19_RUN='38414539835'


def main():
    p=HERE/'B19_NATIVE_SIGNED_RECEIPT_PUBLIC_S0.json'
    raw=p.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=CI_PORTABLE_SHA256:
        raise SystemExit('B20_B19_FIXTURE_NOT_EXACT_ORIGIN_RECEIPT')
    proof=run(base64.b64encode(raw).decode('ascii'),B19_COMMIT)
    if proof['chain_sha256']!=CI_CHAIN_SHA256:
        raise SystemExit('B20_NATIVE_TRACE_DIGEST_NOT_CI_ANCHORED')
    envelope=json.loads(raw)
    linked=verify_linkage(envelope['events'])
    if set(linked['workers'])!={'agent-a','agent-b'} or linked['total_pairs']!=6 or linked['finish_count']!=2 or any(v['matched_pairs']!=3 or v['file_edits']!=2 or v['finish_actions']!=1 for v in linked['workers'].values()):
        raise SystemExit('B20_NATIVE_SDK_CAUSAL_LINK_UNQUALIFIED')
    print('B20_ORIGIN_GITHUB_RUN='+B19_RUN)
    print('B20_LINKED_NATIVE_AGENT_EVENTS='+json.dumps(linked,sort_keys=True))
    print('B20_B19_PORTABLE_SHA256='+proof['portable_sha256'])
    print('AXIOM_B20_GENUINE_NATIVE_TOOL_CAUSAL_IDS_S0_PASS_NOT_PRODUCTION')

if __name__=='__main__':main()
