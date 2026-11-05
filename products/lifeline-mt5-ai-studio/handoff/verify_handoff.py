"""Verify complete clean LIFELINE handoff after extracting GitHub/Drive ZIP.

Usage: python3 verify_handoff.py
No network, providers, credentials or additional dependencies.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent

def digest(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda:f.read(1024*1024), b""):
            h.update(block)
    return h.hexdigest()

def verify():
    manifest_path=ROOT/"handoff/SOURCE_MANIFEST.json"
    manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("origin_repository")!="evansmusitu/mft-axiom-build":
        raise ValueError("unexpected repository")
    if manifest.get("origin_branch")!="product/lifeline-mt5-fivecloud-isolated-20261020":
        raise ValueError("unexpected branch")
    commit=manifest.get("origin_commit_sha")
    if not isinstance(commit,str) or re.fullmatch(r"[a-f0-9]{40}",commit) is None:
        raise ValueError("invalid pinned source SHA")
    checks=(ROOT/"SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()
    expected={}
    for entry in checks:
        if re.fullmatch(r"[a-f0-9]{64}  .+",entry) is None:
            raise ValueError("invalid SHA256SUMS format")
        sha,path=entry.split("  ",1)
        p=Path(path)
        if (p.is_absolute() or ".." in p.parts or path in expected or path=="SHA256SUMS.txt"):
            raise ValueError("duplicate/unsafe manifest path")
        expected[path]=sha
    files={p.relative_to(ROOT).as_posix() for p in ROOT.rglob("*") if p.is_file()}
    if (files-{"SHA256SUMS.txt"})!=set(expected):
        raise ValueError("package has missing or unexpected files")
    for path,sha in expected.items():
        p=ROOT/path
        if p.is_symlink() or digest(p)!=sha:
            raise ValueError("payload SHA256 mismatch: "+path)
    included=manifest.get("included_source_files")
    if not isinstance(included,list) or len(included)<60:
        raise ValueError("incomplete source manifest")
    if len(included)!=manifest.get("included_source_file_count"):
        raise ValueError("source count mismatch")
    for item in included:
        path=item.get("path")
        if not isinstance(path,str) or not path.startswith("source/"):
            raise ValueError("unexpected source path")
        p=ROOT/path
        if (path not in expected or item.get("sha256")!=expected[path]
            or item.get("bytes")!=p.stat().st_size):
            raise ValueError("source manifest mismatch")
    print(json.dumps({"verification":"PASS","source_sha":commit,
      "source_files":len(included),"payload_sha256_files":len(expected),
      "no_unlisted_file":True,"unverified_external_deployments":True},sort_keys=True))

if __name__=="__main__":
    try:verify()
    except Exception as e:
        print("handoff_verification_failed: "+str(e),file=sys.stderr)
        sys.exit(1)
