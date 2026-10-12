#!/usr/bin/env python3
"""Validate B15 manifest and run read-only JavaScript test suite."""
from pathlib import Path
import hashlib, subprocess, sys
p=Path(__file__).resolve().parent
checks=(p/'MANIFEST.sha256').read_text().splitlines()
for line in checks:
    sha, name=line.split('  ',1)
    f=p/name
    if not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest()!=sha:
        sys.exit('B15_MANIFEST_FAILED: '+name)
print('B15_MANIFEST_VERIFIED',len(checks))
for name in ['ledger_core.mjs','durable_object.mjs']:
    r=subprocess.run(['node','--check',str(p/name)],capture_output=True,text=True)
    if r.returncode:sys.exit('B15_NODE_SYNTAX_FAILED: '+name+' '+r.stderr[-400:])
print('B15_NODE_SYNTAX_PASS')
r=subprocess.run(['node','--test',str(p/'test_ledger.mjs')],capture_output=True,text=True)
if r.returncode or '# pass 23' not in r.stdout or '# fail 0' not in r.stdout:
    print(r.stdout[-2000:]);print(r.stderr[-500:]);sys.exit('B15_REGRESSION_TESTS_FAILED')
print('B15_SQLITE_SIGNED_POLICY_23_TESTS_PASS')
print('MUSITU_AXIOM_B15_LOCAL_CANDIDATE_VERIFY_PASS_NO_CLOUD_DEPLOYMENT')