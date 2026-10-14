#!/usr/bin/env python3
"""B27 scoped local integrity/syntax/test gate. No external security certification."""
import hashlib
import re
import subprocess
import sys
from pathlib import Path
BASE=Path(__file__).resolve().parent
REPO=BASE.parents[1]
paths=[REPO/'ops/trackb25/quorum.py', REPO/'ops/trackb26/witness_gate.py',
       REPO/'ops/trackb26/synthetic_witness.py']
expected=['9b4ed7c9174525a5cb0e7cdfb6e0af53eae7045c6a0922e6dc7954880abcc0ae',
          '46ec06b98d9823ce652ca68e18ec0112f671dbd69049295d45e3c57edbb11609',
          '8a8b8ee17bc468b0a5644d45dd27cabfb1a3df493d04bb881141b2b1d14d70dd']
for p,sha in zip(paths,expected):
    if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=sha:
        sys.exit('AXIOM_B27_INHERITED_VERIFIED_SOURCE_MISMATCH:'+str(p))
print('AXIOM_B27_B25_B26_EXACT_PARENT_SHA256_PASS')
manifest=BASE/'MANIFEST.sha256'
rows=manifest.read_text().splitlines()
if len(rows)<5:sys.exit('AXIOM_B27_MANIFEST_INCOMPLETE')
seen=set()
for row in rows:
    sha,sep,rel=row.partition('  ')
    p=(BASE/rel).resolve()
    if not sep or not re.fullmatch(r'[a-f0-9]{64}',sha) or not p.is_relative_to(BASE) or p in seen or not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=sha:
        sys.exit('AXIOM_B27_MANIFEST_DENIED:'+rel)
    seen.add(p)
print('AXIOM_B27_MANIFEST_SHA256_PASS',len(seen))
for p in ['remote_witness.py','witness_server.py','test/test_remote.py','VERIFY_B27_LOCAL.py']:
    subprocess.run([sys.executable,'-m','py_compile',str(BASE/p)],check=True)
print('AXIOM_B27_SYNTAX_PASS 4')
cmd=[sys.executable,'-m','unittest','discover','-s',str(BASE/'test'),'-p','test_*.py','-v']
x=subprocess.run(cmd,cwd=BASE,capture_output=True,text=True,timeout=120)
print(x.stderr[-5500:]);print(x.stdout[-800:])
if x.returncode!=0 or 'FAILED' in x.stderr or 'Ran 15 tests' not in x.stderr:
    sys.exit('AXIOM_B27_SOCKET_SUITE_FAILED')
print('AXIOM_B27_BOUNDARY_TESTS_PASS 15 NOT_EXTERNAL')
print('AXIOM_B27_GLOBAL_ROLLBACK_COUNTEREXAMPLE_REPRODUCED_NOT_FIXED')
print('AXIOM_B27_S0_LOOPBACK_WITNESS_NETWORK_BOUNDARY_PASS_NOT_EXTERNAL')
