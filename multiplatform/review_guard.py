from __future__ import annotations
import json
import pathlib
import subprocess

MANIFEST=pathlib.Path("frontier_review_safe/review_snapshot_manifest.json")

def git(*args: str) -> str:
    return subprocess.check_output(["git",*args],text=True).strip()

def main() -> None:
    manifest=json.loads(MANIFEST.read_text(encoding="utf-8"))
    if git("merge-base","HEAD","main") != manifest["sealed_main_sha"]:
        raise SystemExit("FROZEN_BASE_MISMATCH")
    if manifest["authoritative_frontier_sha"] != "d9196774a9fff3150922e2cb681d16e2423651da":
        raise SystemExit("AUTHORITATIVE_FRONTIER_CHANGED")
    changed=git("diff","--name-only",f'{manifest["authoritative_frontier_sha"]}..HEAD').splitlines()
    for path in changed:
        if any(path==q or path.startswith(q.rstrip("/")+"/") for q in manifest["protected_paths"]):
            raise SystemExit("REVIEW_PROTECTED_PATH_CHANGED:"+path)
    print(json.dumps({"status":"PASS","sealed_main_sha":manifest["sealed_main_sha"],"authoritative_frontier_sha":manifest["authoritative_frontier_sha"],"protected_paths_checked":len(manifest["protected_paths"]),"changed_paths":len(changed)},sort_keys=True))

if __name__=="__main__":
    main()
