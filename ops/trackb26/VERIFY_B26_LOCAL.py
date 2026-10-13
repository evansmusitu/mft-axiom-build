#!/usr/bin/env python3
"""B26 S0 source verification; deliberately does not certify external authority."""
import hashlib
from pathlib import Path
import subprocess
import sys
import re

root=Path(__file__).resolve().parent
repo=root.parents[1]
parent=repo/'ops/trackb25/quorum.py'
expected_sha=''
try:
    expected_sha=(root/'B25_PARENT_QUORUM_SHA256.txt').read_text().strip()
    assert re.fullmatch(r'[a-f0-9]{64}',expected_sha)
    assert hashlib.sha256(parent.read_bytes()).hexdigest()==expected_sha
except (AssertionError,OSError,ValueError):
    sys.exit('B26_PARENT_B25_SOURCE_MISMATCH')
print('AXIOM_B26_PARENT_B25_QUORUM_SOURCE_MATCH')
lines=(root/'MANIFEST.sha256').read_text().splitlines()
if len(lines)<7:sys.exit('B26_MANIFEST_INCOMPLETE')
seen=set()
for line in lines:
    digest,sep,rel=line.partition('  ')
    candidate=(root/rel).resolve()
    if (not sep or not re.fullmatch(r'[a-f0-9]{64}',digest) or
        not candidate.is_relative_to(root) or candidate in seen or not candidate.is_file() or
        hashlib.sha256(candidate.read_bytes()).hexdigest()!=digest):
        sys.exit('B26_MANIFEST_MISMATCH:'+rel)
    seen.add(candidate)
print('AXIOM_B26_MANIFEST_SHA256_PASS',len(seen))
for name in ['witness_gate.py','synthetic_witness.py','test/test_witness.py','test/test_concurrency.py']:
    subprocess.run([sys.executable,'-m','py_compile',str(root/name)],check=True,
       env={'PYTHONDONTWRITEBYTECODE':'1'})
print('AXIOM_B26_PYTHON_SYNTAX_PASS 4')
cmd=[sys.executable,'-m','unittest','discover','-s',str(root/'test'),'-p','test_*.py','-q']
proc=subprocess.run(cmd,cwd=root,capture_output=True,text=True,timeout=60)
print(proc.stderr[-1400:])
if proc.returncode!=0 or 'FAILED' in proc.stderr:
    sys.exit('B26_LOCAL_TEST_FAILURE')
print('AXIOM_B26_S0_SYNTHETIC_WITNESS_TESTS_PASS_NOT_EXTERNAL')
print('AXIOM_B26_EXTERNAL_AUTHORITY_NOT_CERTIFIED_ZERO_PROVIDER_CALLS')
