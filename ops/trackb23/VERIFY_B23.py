#!/usr/bin/env python3
"""Verify isolated B23 source integrity; does not grant cloud or production authority."""
import hashlib
from pathlib import Path
import sys
root=Path(__file__).resolve().parent
lines=(root/'MANIFEST.sha256').read_text().splitlines()
if not lines:sys.exit('B23_EMPTY_MANIFEST_DENIED')
seen=set()
for line in lines:
    sha,sep,name=line.partition('  ')
    path=(root/name).resolve()
    if not sep or len(sha)!=64 or path in seen or not path.is_relative_to(root) or not path.is_file():
        sys.exit('B23_MANIFEST_LAYOUT_DENIED')
    seen.add(path)
    if hashlib.sha256(path.read_bytes()).hexdigest()!=sha:sys.exit('B23_SOURCE_HASH_MISMATCH:'+name)
print('AXIOM_B23_SOURCE_MANIFEST_S0_PASS',len(lines))
