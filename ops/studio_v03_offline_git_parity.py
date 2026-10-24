"""Read-only Git blob parity and SHA-256 evidence for isolated Studio handoffs.

Produces deterministic, content-only evidence from files explicitly listed by
an operator. Does not contact GitHub, inspect private runtime data or make writes
except to stdout. A matching Git SHA-1 identifies an object in SHA-1 repositories;
SHA-256 is separately emitted for stronger archive integrity. The live GitHub
ref and its stored blob SHAs MUST still be fetched independently.
"""
from __future__ import annotations
import hashlib
import json
import pathlib
import re
import sys

SHA1 = re.compile(r"^[0-9a-f]{40}$")


def verify_selected_files(root: pathlib.Path, entries: list[str], expected_blobs: dict[str, str] | None = None) -> dict:
    if root.is_symlink():
        raise ValueError("STUDIO_GIT_PARITY_ROOT_INVALID")
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("STUDIO_GIT_PARITY_ROOT_INVALID")
    if not isinstance(entries, list) or not entries or len(entries)>25000:
        raise ValueError("STUDIO_GIT_PARITY_PATH_SET_INVALID")
    if expected_blobs is not None and (not isinstance(expected_blobs, dict) or set(entries)!=set(expected_blobs)):
        raise ValueError("STUDIO_GIT_PARITY_EXPECTATIONS_INCOMPLETE")
    evidence={}
    for name in entries:
        if (not isinstance(name,str) or len(name)>512 or not name or name.startswith('/') or
            '\\' in name or any(part in ('..','.','', '.git') for part in name.split('/')) or
            any(ord(c)<32 or ord(c)==127 for c in name) or name in evidence):
            raise ValueError("STUDIO_GIT_PARITY_PATH_INVALID")
        file = root.joinpath(*name.split('/'))
        # Resolve only *after* rejecting symlinks on every parent segment.
        candidate = root
        for part in name.split('/'):
            candidate=candidate/part
            if candidate.is_symlink():
                raise ValueError("STUDIO_GIT_PARITY_SYMLINK_REJECTED")
        if not file.is_file() or not file.resolve(strict=True).is_relative_to(root):
            raise ValueError("STUDIO_GIT_PARITY_NOT_A_SOURCE_FILE")
        raw=file.read_bytes()
        if len(raw)>10000000:
            raise ValueError("STUDIO_GIT_PARITY_FILE_TOO_LARGE")
        sha1=hashlib.sha1(b'blob '+str(len(raw)).encode('ascii')+b'\0'+raw).hexdigest()
        sha256=hashlib.sha256(raw).hexdigest()
        if expected_blobs is not None:
            exp=expected_blobs[name]
            if not isinstance(exp,str) or not SHA1.fullmatch(exp) or exp!=sha1:
                raise ValueError("STUDIO_GIT_PARITY_BLOB_MISMATCH")
        evidence[name]={'git_blob_sha1':sha1,'sha256':sha256,'bytes':len(raw)}
    return {'schema':'musitu.studio.v03.offline-git-blob-parity.v1',
            'source_only':True,'provider_verified':False,'files':dict(sorted(evidence.items()))}


def main(argv:list[str]) -> int:
    if len(argv)!=3:
        raise ValueError("Usage: python ops/studio_v03_offline_git_parity.py ROOT paths.json")
    root=pathlib.Path(argv[1])
    conf=json.loads(pathlib.Path(argv[2]).read_text())
    if not isinstance(conf,dict) or set(conf)!={'files','expected_git_blobs'}:
        raise ValueError("STUDIO_GIT_PARITY_MANIFEST_INVALID")
    result=verify_selected_files(root,conf['files'],conf['expected_git_blobs'])
    print(json.dumps(result,sort_keys=True,separators=(',',':')))
    return 0

if __name__=='__main__':
    try:
        raise SystemExit(main(sys.argv))
    except (ValueError,KeyError,TypeError,OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
