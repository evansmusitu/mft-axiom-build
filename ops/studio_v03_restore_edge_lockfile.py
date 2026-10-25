#!/usr/bin/env python3
"""Offline, deterministic Edge dependency-lock restoration from immutable parts.

Runs only inside the checked-out Studio repository. Does not contact any
provider, execute package code, modify a customer record or install packages.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import tempfile

EXPECTED_SHA256 = '10f3c5d53d27ee3743a8e507089eb937af73f4a2c672573bdae958c9a3c5c9df'
FRAGMENTS = ('edge-lock-v3.000.part','edge-lock-v3.001.part','edge-lock-v3.002.part')


def verify_lock_bytes(repository_root: Path) -> bytes:
    source = repository_root/'ops/verified_edge_lock_parts'
    chunks = []
    for name in FRAGMENTS:
        path = source/name
        if path.is_symlink() or not path.is_file():
            raise ValueError('STUDIO_EDGE_LOCK_PART_MISSING_OR_SYMLINK')
        blob = path.read_bytes()
        if not blob or len(blob) > 25000:
            raise ValueError('STUDIO_EDGE_LOCK_PART_OVERSIZED')
        chunks.append(blob)
    raw = b''.join(chunks)
    if len(raw)>80000 or hashlib.sha256(raw).hexdigest()!=EXPECTED_SHA256:
        raise ValueError('LOCK_SHA256_MISMATCH')
    decoded = json.loads(raw)
    if decoded.get('lockfileVersion')!=3 or not isinstance(decoded.get('packages'),dict):
        raise ValueError('STUDIO_EDGE_LOCK_SCHEMA_INVALID')
    return raw


def restore() -> None:
    root = Path(__file__).resolve().parents[1]
    target = root/'musitu_studio/edge/package-lock.json'
    package = json.loads((target.parent/'package.json').read_text())
    data = verify_lock_bytes(root)
    locked_root = json.loads(data)['packages']['']
    if (locked_root.get('dependencies')!=package.get('dependencies') or
            locked_root.get('devDependencies')!=package.get('devDependencies')):
        raise ValueError('STUDIO_EDGE_PACKAGE_LOCK_DEPENDENCIES_CHANGED')
    if target.is_symlink():
        raise ValueError('STUDIO_EDGE_LOCK_TARGET_SYMLINK')
    if target.exists():
        if target.read_bytes()!=data:
            raise ValueError('STUDIO_EDGE_EXISTING_LOCK_MISMATCH')
        print('STUDIO_EDGE_LOCK_PRESENT_AND_VERIFIED',EXPECTED_SHA256)
        return
    with tempfile.NamedTemporaryFile(mode='wb',dir=target.parent,prefix='.studio-lock-',delete=False) as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
        tmp=Path(f.name)
    try:
        # os.replace() would overwrite a valuable lockfile or a symlink
        # created by another process after the earlier exists() check.
        # Hard-link the fully written temporary inode into place atomically.
        # On EEXIST leave the independently created destination untouched.
        os.link(tmp,target)
    finally:
        if tmp.exists():tmp.unlink()
    print('STUDIO_EDGE_LOCK_RECONSTRUCTED_AND_VERIFIED',EXPECTED_SHA256)


if __name__=='__main__':
    restore()
