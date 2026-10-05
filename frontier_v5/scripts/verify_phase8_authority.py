#!/usr/bin/env python3
from __future__ import annotations
import json, pathlib, subprocess
from frontier_review_safe.review_snapshot import ReviewSnapshotGuard, ReviewSnapshotManifest

EXPECTED={
 'refs/remotes/origin/main':'d6a846f6bbe0bccac1758713eb4de167caf07113',
 'refs/remotes/origin/frontier/axiom-v5-skill-fabric':'d9196774a9fff3150922e2cb681d16e2423651da',
 'refs/remotes/origin/archive/axiom-track-a-post-freeze-20260912':'20a84b1090b8ad986e35fee20008f3ed8920440c',
 'refs/remotes/origin/frontier/axiom-v5-world-top-tier-review-safe':'73ecdbad38cb10020b6e30ebe42a9222a3bb6c55',
}
PHASE7_SEAL='e4830ef40531d1cc0780fd7f6c492b902b959bc5'
def git(*args): return subprocess.check_output(['git',*args],text=True).strip()
def main():
 for ref,sha in EXPECTED.items():
  got=git('rev-parse',ref)
  if got!=sha: raise SystemExit(f'authority drift {ref}: {got} != {sha}')
 subprocess.check_call(['git','merge-base','--is-ancestor',PHASE7_SEAL,'HEAD'])
 raw=json.loads(pathlib.Path('frontier_review_safe/review_snapshot_manifest.json').read_text(encoding='utf-8'))
 m=ReviewSnapshotManifest(schema=raw['schema'],authoritative_frontier_sha=raw['authoritative_frontier_sha'],sealed_main_sha=raw['sealed_main_sha'],public_tool_count=raw['public_tool_count'],required_scopes=tuple(raw['required_scopes']),forbidden_tools=tuple(raw['forbidden_tools']),protected_paths=tuple(raw['protected_paths']),protected_git_object_shas=dict(raw['protected_git_object_shas']),mcp_url=raw['mcp_url'],auth_url=raw['auth_url'],demo_url=raw['demo_url'])
 g=ReviewSnapshotGuard(m)
 authoritative={p:git('rev-parse',f'{m.authoritative_frontier_sha}:{p}') for p in m.protected_git_object_shas}
 current={p:git('rev-parse',f'HEAD:{p}') for p in m.protected_git_object_shas}
 g.verify_tree(authoritative);g.verify_tree(current)
 changed=[x for x in git('diff','--name-only',f'{m.authoritative_frontier_sha}..HEAD').splitlines() if x]
 g.verify_no_protected_diff(changed,m.protected_paths)
 print(json.dumps({'status':'PASS','phase7_seal_ancestor':PHASE7_SEAL,'protected_objects_verified':len(current)},sort_keys=True))
 print('MUSITU_AXIOM_INTERFACE_PHASE8_AUTHORITY_PASS')
if __name__=='__main__': main()
