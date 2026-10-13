#!/usr/bin/env python3
"""S0-only verifier: source bytes and full local tests, no external authority."""
from pathlib import Path
import hashlib
import subprocess
import sys
ROOT = Path(__file__).resolve().parent
entries = (ROOT/'MANIFEST.sha256').read_text(encoding='utf8').splitlines()
assert len(entries)>=6,'B24_MANIFEST_INCOMPLETE'
seen=set()
for line in entries:
    sha,sep,path=line.partition('  ')
    item=(ROOT/path).resolve()
    if not sep or item in seen or not item.is_relative_to(ROOT) or not item.is_file():
        raise SystemExit('B24_MANIFEST_UNSAFE_PATH')
    seen.add(item)
    if hashlib.sha256(item.read_bytes()).hexdigest()!=sha:
        raise SystemExit('B24_MANIFEST_HASH_FAILED:'+path)
print('B24_LOCAL_MANIFEST_PASS',len(entries),flush=True)
for cmd in ([sys.executable,'-m','py_compile','authority.py','test/test_authority.py'],
            [sys.executable,'-m','unittest','discover','-v','-s','test','-p','test_*.py']):
    p=subprocess.run(cmd,cwd=ROOT,timeout=45)
    if p.returncode:raise SystemExit('B24_TEST_OR_SYNTAX_FAILED')
print('AXIOM_B24_S0_SYNTHETIC_AUTHORITY_LOCAL_PASS_NOT_EXTERNAL_NOT_PRODUCTION')