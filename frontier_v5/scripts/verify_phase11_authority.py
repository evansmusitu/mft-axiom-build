#!/usr/bin/env python3
from __future__ import annotations
import json,pathlib,subprocess
from frontier_review_safe.review_snapshot import ReviewSnapshotGuard,ReviewSnapshotManifest
EXPECTED={'refs/remotes/origin/main':'d6a846f6bbe0bccac1758713eb4de167caf07113','refs/remotes/origin/frontier/axiom-v5-skill-fabric':'d9196774a9fff3150922e2cb681d16e2423651da','refs/remotes/origin/archive/axiom-track-a-post-freeze-20260912':'20a84b1090b8ad986e35fee20008f3ed8920440c','refs/remotes/origin/frontier/axiom-v5-world-top-tier-review-safe':'73ecdbad38cb10020b6e30ebe42a9222a3bb6c55'}
PHASE10_SEAL='a8589d0295f3a3b9b88f9f0dd8251d7d43e1c143';PHASE10_IMPLEMENTATION='78d76060138a00e48839edb1d5454f1a197225b3'
PHASE11_IMPLEMENTATION='3952a9c41f6069f8f0f9427cd99779a95e0cd443';PHASE11_RUN=34748687809;PHASE11_EVIDENCE=10315500972;PHASE11_EVIDENCE_DIGEST='sha256:e9852d2eed21f196d21e8d823591b6e1b29f18969795d66648d362aebcf5fe53';PHASE11_RUNTIME=10315037000;PHASE11_RUNTIME_DIGEST='sha256:a93111f638230ef697b8241cdc77703cf427e54a25d4b7ae034b2b9326051bed'
def git(*args):return subprocess.check_output(['git',*args],text=True).strip()
def verify_surface(surface):
 authority=surface['authority']
 if authority.get('qualified_phase10_sha')!=PHASE10_IMPLEMENTATION or surface.get('memory_graph_substrate',{}).get('status')!='EARNED':raise SystemExit('earned Phase-10 memory authority drift')
 schema=surface.get('schema');phase=surface.get('phase')
 if schema=='musitu.axiom.interface.surface-map.v10' and phase=='PHASE_10_MEMORY_GRAPH':
  if authority.get('qualified_phase11_sha') is not None or 'operator_enterprise_control_plane_substrate' in surface:raise SystemExit('Phase-11 authority present before exact seal')
  return 'PHASE11_QUALIFICATION_FROM_PHASE10'
 if schema=='musitu.axiom.interface.surface-map.v11' and phase=='PHASE_11_OPERATOR_ENTERPRISE_CONTROL_PLANE':
  subprocess.check_call(['git','merge-base','--is-ancestor',PHASE11_IMPLEMENTATION,'HEAD'])
  expected={'qualified_phase11_sha':PHASE11_IMPLEMENTATION,'qualified_phase11_run_id':PHASE11_RUN,'qualified_phase11_evidence_artifact_id':PHASE11_EVIDENCE,'qualified_phase11_evidence_digest':PHASE11_EVIDENCE_DIGEST,'qualified_phase11_runtime_security_artifact_id':PHASE11_RUNTIME,'qualified_phase11_runtime_security_evidence_digest':PHASE11_RUNTIME_DIGEST,'qualified_phase11_artifact_binding_verified':True}
  for key,value in expected.items():
   if authority.get(key)!=value:raise SystemExit(f'Phase-11 authority mismatch {key}: {authority.get(key)!r} != {value!r}')
  op=surface.get('operator_enterprise_control_plane_substrate',{})
  expected_op={'status':'EARNED','qualification_scope':'BROWSER_LOCAL_ENTERPRISE_OPERATOR_CONTROL_PLANE_PREVIEW','qualified_sha':PHASE11_IMPLEMENTATION,'workflow_run_id':PHASE11_RUN,'evidence_artifact_id':PHASE11_EVIDENCE,'evidence_artifact_digest':PHASE11_EVIDENCE_DIGEST,'runtime_security_evidence_artifact_id':PHASE11_RUNTIME,'runtime_security_evidence_artifact_digest':PHASE11_RUNTIME_DIGEST,'evidence_metadata_source':'GITHUB_ACTIONS_RUN_ARTIFACTS_API','evidence_metadata_verified':True,'persistence':'INDEXEDDB_BROWSER_LOCAL_DEVICE','roles':['owner','admin','analyst','viewer'],'network_policy':'DENY_ALL_EXTERNAL_NETWORK','control_plane_mode':'BROWSER_LOCAL_ADMIN_PREVIEW_ONLY_NO_PRODUCTION_MUTATION','identity_policy':'LOCAL_ENTERPRISE_PREVIEW_NOT_PRODUCTION_IDENTITY_PROVIDER','billing_policy':'NO_PAYMENT_PROCESSING_OR_SETTLEMENT','hidden_reasoning_policy':'NO_HIDDEN_REASONING_OR_SECRET_STORAGE','preview_integrity':'SHA256_BOUND_EXACT_ROLE_AND_POLICY_PREVIEWS','audit_integrity':'SHA256_LINKED_EVENTS_MEMBERS_RECEIPTS','posture_scope':'AGENTS_AUTOMATIONS_OBSERVABILITY_SLO_LOCAL_COMPUTE','production_identity_mutation_claimed':False,'production_billing_claimed':False,'cloud_control_plane_claimed':False,'external_action_execution_claimed':False,'hidden_reasoning_recorded':False,'production_policy_enforcement_claimed':False}
  for key,value in expected_op.items():
   if op.get(key)!=value:raise SystemExit(f'Phase-11 operator authority mismatch {key}: {op.get(key)!r} != {value!r}')
  if 'operator' not in surface.get('workspace_routes',[]):raise SystemExit('Phase-11 operator route missing')
  if surface.get('execution_boundary')!='PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS':raise SystemExit('Phase-11 execution boundary drift')
  return 'PHASE11_SEALED'
 raise SystemExit(f'unrecognized Phase-11 authority state: schema={schema!r} phase={phase!r}')
def main():
 for ref,expected in EXPECTED.items():
  actual=git('rev-parse',ref)
  if actual!=expected:raise SystemExit(f'authority drift {ref}: {actual} != {expected}')
 subprocess.check_call(['git','merge-base','--is-ancestor',PHASE10_SEAL,'HEAD'])
 surface=json.loads(pathlib.Path('axiom_interface/surface-map.json').read_text(encoding='utf-8'));mode=verify_surface(surface)
 raw=json.loads(pathlib.Path('frontier_review_safe/review_snapshot_manifest.json').read_text(encoding='utf-8'));manifest=ReviewSnapshotManifest(schema=raw['schema'],authoritative_frontier_sha=raw['authoritative_frontier_sha'],sealed_main_sha=raw['sealed_main_sha'],public_tool_count=raw['public_tool_count'],required_scopes=tuple(raw['required_scopes']),forbidden_tools=tuple(raw['forbidden_tools']),protected_paths=tuple(raw['protected_paths']),protected_git_object_shas=dict(raw['protected_git_object_shas']),mcp_url=raw['mcp_url'],auth_url=raw['auth_url'],demo_url=raw['demo_url']);guard=ReviewSnapshotGuard(manifest);authoritative={path:git('rev-parse',f'{manifest.authoritative_frontier_sha}:{path}') for path in manifest.protected_git_object_shas};current={path:git('rev-parse',f'HEAD:{path}') for path in manifest.protected_git_object_shas};guard.verify_tree(authoritative);guard.verify_tree(current);changed=[p for p in git('diff','--name-only',f'{manifest.authoritative_frontier_sha}..HEAD').splitlines() if p];guard.verify_no_protected_diff(changed,manifest.protected_paths);print(json.dumps({'status':'PASS','authority_mode':mode,'phase10_seal_ancestor':PHASE10_SEAL,'qualified_phase10_sha':PHASE10_IMPLEMENTATION,'qualified_phase11_sha':surface['authority'].get('qualified_phase11_sha'),'protected_objects_verified':len(current)},sort_keys=True));print('MUSITU_AXIOM_INTERFACE_PHASE11_AUTHORITY_PASS')
if __name__=='__main__':main()
