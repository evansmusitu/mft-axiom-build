#!/usr/bin/env python3
from __future__ import annotations
import json,pathlib,subprocess
from frontier_review_safe.review_snapshot import ReviewSnapshotGuard,ReviewSnapshotManifest
EXPECTED={'refs/remotes/origin/main':'d6a846f6bbe0bccac1758713eb4de167caf07113','refs/remotes/origin/frontier/axiom-v5-skill-fabric':'d9196774a9fff3150922e2cb681d16e2423651da','refs/remotes/origin/archive/axiom-track-a-post-freeze-20260912':'20a84b1090b8ad986e35fee20008f3ed8920440c','refs/remotes/origin/frontier/axiom-v5-world-top-tier-review-safe':'73ecdbad38cb10020b6e30ebe42a9222a3bb6c55'}
PHASE9_SEAL='4fb751a341e8fed980e644294e335c490084f9e6';PHASE9_IMPLEMENTATION='277478e12529f755fc4269b648e8fbe08caafb92'
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def main():
 for ref,expected in EXPECTED.items():
  actual=git('rev-parse',ref)
  if actual!=expected:raise SystemExit(f'authority drift {ref}: {actual} != {expected}')
 subprocess.check_call(['git','merge-base','--is-ancestor',PHASE9_SEAL,'HEAD'])
 surface=json.loads(pathlib.Path('axiom_interface/surface-map.json').read_text(encoding='utf-8'));authority=surface['authority']
 if authority.get('qualified_phase9_sha')!=PHASE9_IMPLEMENTATION:raise SystemExit('qualified Phase-9 implementation authority drift')
 if surface.get('agent_automation_substrate',{}).get('status')!='EARNED':raise SystemExit('earned Phase-9 agent substrate not preserved')
 raw=json.loads(pathlib.Path('frontier_review_safe/review_snapshot_manifest.json').read_text(encoding='utf-8'));manifest=ReviewSnapshotManifest(schema=raw['schema'],authoritative_frontier_sha=raw['authoritative_frontier_sha'],sealed_main_sha=raw['sealed_main_sha'],public_tool_count=raw['public_tool_count'],required_scopes=tuple(raw['required_scopes']),forbidden_tools=tuple(raw['forbidden_tools']),protected_paths=tuple(raw['protected_paths']),protected_git_object_shas=dict(raw['protected_git_object_shas']),mcp_url=raw['mcp_url'],auth_url=raw['auth_url'],demo_url=raw['demo_url']);guard=ReviewSnapshotGuard(manifest);authoritative={path:git('rev-parse',f'{manifest.authoritative_frontier_sha}:{path}') for path in manifest.protected_git_object_shas};current={path:git('rev-parse',f'HEAD:{path}') for path in manifest.protected_git_object_shas};guard.verify_tree(authoritative);guard.verify_tree(current);changed=[p for p in git('diff','--name-only',f'{manifest.authoritative_frontier_sha}..HEAD').splitlines() if p];guard.verify_no_protected_diff(changed,manifest.protected_paths);print(json.dumps({'status':'PASS','phase9_seal_ancestor':PHASE9_SEAL,'qualified_phase9_sha':PHASE9_IMPLEMENTATION,'protected_objects_verified':len(current)},sort_keys=True));print('MUSITU_AXIOM_INTERFACE_PHASE10_AUTHORITY_PASS')
if __name__=='__main__':main()
