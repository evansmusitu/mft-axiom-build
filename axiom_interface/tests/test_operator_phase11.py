from __future__ import annotations
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
PHASE11_SHA='3952a9c41f6069f8f0f9427cd99779a95e0cd443';PHASE11_RUN=34748687809;PHASE11_EVIDENCE=10315500972;PHASE11_EVIDENCE_DIGEST='sha256:e9852d2eed21f196d21e8d823591b6e1b29f18969795d66648d362aebcf5fe53';PHASE11_RUNTIME=10315037000;PHASE11_RUNTIME_DIGEST='sha256:a93111f638230ef697b8241cdc77703cf427e54a25d4b7ae034b2b9326051bed'
SEC=(ROOT/'operator_security.js').read_text(encoding='utf-8');STORE=(ROOT/'operator_store.js').read_text(encoding='utf-8');UI=(ROOT/'operator_ui.js').read_text(encoding='utf-8');BOOT=(ROOT/'operator_bootstrap.js').read_text(encoding='utf-8');MEMBOOT=(ROOT/'memory_bootstrap.js').read_text(encoding='utf-8');SW=(ROOT/'sw.js').read_text(encoding='utf-8');SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))
class Phase11OperatorContractTests(unittest.TestCase):
 def test_control_plane_is_progressive_and_user_facing(self):
  self.assertIn("#/operator",UI);self.assertIn('AxiomOperatorBootstrap',BOOT);self.assertIn("import('./operator_bootstrap.js')",MEMBOOT);self.assertIn('Operator & enterprise control plane',UI)
 def test_backend_aligned_rbac_and_exact_preview_controls(self):
  for role in ['owner','admin','analyst','viewer']:self.assertIn(role,SEC)
  for permission in ['org.manage','domain.manage','workspace.manage','member.manage','policy.manage','audit.read','analysis.execute','analysis.read']:self.assertIn(permission,SEC)
  for token in ['prepareRoleChange','applyRoleChange','preparePolicy','applyPolicy','final active owner cannot be demoted','stale or altered policy preview','stale or altered role-change preview']:self.assertIn(token,STORE)
 def test_operator_posture_composes_earned_agents_and_observability(self):
  for token in ['this.agents.store.listAgents','this.agents.store.listAutomations','this.observability.store.operatorHealth','this.agents.store.verify','this.observability.store.verify','FAILURE_RATE_SLO','ACTIVE_AGENT_LIMIT','LOCAL_COMPUTE_LIMIT']:self.assertIn(token,STORE)
 def test_truth_boundaries_are_explicit(self):
  for token in ['DENY_ALL_EXTERNAL_NETWORK','BROWSER_LOCAL_ADMIN_PREVIEW_ONLY_NO_PRODUCTION_MUTATION','NO_PAYMENT_PROCESSING_OR_SETTLEMENT','LOCAL_ENTERPRISE_PREVIEW_NOT_PRODUCTION_IDENTITY_PROVIDER','NO_HIDDEN_REASONING_OR_SECRET_STORAGE']:self.assertIn(token,SEC)
  for text in [SEC,STORE,UI,BOOT]:
   self.assertNotIn('fetch(',text);self.assertNotIn('WebSocket(',text);self.assertNotIn('EventSource(',text)
  for token in ['production_identity_mutation_claimed:false','production_billing_claimed:false','cloud_control_plane_claimed:false','external_action_execution_claimed:false','hidden_reasoning_recorded:false']:self.assertIn(token,STORE)
 def test_tamper_evident_events_members_and_receipts(self):
  for token in ['previous_event_sha256','event_sha256','member_sha256','receipt_sha256','verify(orgId)']:self.assertIn(token,STORE)
 def test_offline_shell_contains_phase11_assets(self):
  for asset in ['./operator_bootstrap.js','./operator_security.js','./operator_store.js','./operator_ui.js','./styles/operator.css']:self.assertIn(asset,SW)
  self.assertIn('axiom-interface-phase11-v1',SW);self.assertIn('axiom-interface-phase10-v1',SW)
 def test_phase11_authority_is_exact_when_sealed(self):
  authority=SURFACE['authority'];phase11=authority.get('qualified_phase11_sha')
  if phase11 is None:
   self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v10');self.assertEqual(SURFACE['phase'],'PHASE_10_MEMORY_GRAPH');self.assertEqual(SURFACE['memory_graph_substrate']['status'],'EARNED');self.assertNotIn('operator_enterprise_control_plane_substrate',SURFACE);return
  self.assertEqual(phase11,PHASE11_SHA);self.assertEqual(authority['qualified_phase11_run_id'],PHASE11_RUN);self.assertEqual(authority['qualified_phase11_evidence_artifact_id'],PHASE11_EVIDENCE);self.assertEqual(authority['qualified_phase11_evidence_digest'],PHASE11_EVIDENCE_DIGEST);self.assertEqual(authority['qualified_phase11_runtime_security_artifact_id'],PHASE11_RUNTIME);self.assertEqual(authority['qualified_phase11_runtime_security_evidence_digest'],PHASE11_RUNTIME_DIGEST);self.assertTrue(authority['qualified_phase11_artifact_binding_verified']);self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v11');self.assertEqual(SURFACE['phase'],'PHASE_11_OPERATOR_ENTERPRISE_CONTROL_PLANE')
  op=SURFACE['operator_enterprise_control_plane_substrate'];self.assertEqual(op['status'],'EARNED');self.assertEqual(op['qualification_scope'],'BROWSER_LOCAL_ENTERPRISE_OPERATOR_CONTROL_PLANE_PREVIEW');self.assertEqual(op['qualified_sha'],PHASE11_SHA);self.assertEqual(op['workflow_run_id'],PHASE11_RUN);self.assertEqual(op['evidence_artifact_id'],PHASE11_EVIDENCE);self.assertEqual(op['evidence_artifact_digest'],PHASE11_EVIDENCE_DIGEST);self.assertEqual(op['runtime_security_evidence_artifact_id'],PHASE11_RUNTIME);self.assertEqual(op['runtime_security_evidence_artifact_digest'],PHASE11_RUNTIME_DIGEST);self.assertEqual(op['evidence_metadata_source'],'GITHUB_ACTIONS_RUN_ARTIFACTS_API');self.assertTrue(op['evidence_metadata_verified']);self.assertEqual(op['persistence'],'INDEXEDDB_BROWSER_LOCAL_DEVICE');self.assertEqual(op['roles'],['owner','admin','analyst','viewer']);self.assertEqual(op['network_policy'],'DENY_ALL_EXTERNAL_NETWORK');self.assertEqual(op['control_plane_mode'],'BROWSER_LOCAL_ADMIN_PREVIEW_ONLY_NO_PRODUCTION_MUTATION');self.assertEqual(op['identity_policy'],'LOCAL_ENTERPRISE_PREVIEW_NOT_PRODUCTION_IDENTITY_PROVIDER');self.assertEqual(op['billing_policy'],'NO_PAYMENT_PROCESSING_OR_SETTLEMENT');self.assertEqual(op['hidden_reasoning_policy'],'NO_HIDDEN_REASONING_OR_SECRET_STORAGE');self.assertEqual(op['preview_integrity'],'SHA256_BOUND_EXACT_ROLE_AND_POLICY_PREVIEWS');self.assertEqual(op['audit_integrity'],'SHA256_LINKED_EVENTS_MEMBERS_RECEIPTS');self.assertEqual(op['posture_scope'],'AGENTS_AUTOMATIONS_OBSERVABILITY_SLO_LOCAL_COMPUTE');self.assertFalse(op['production_identity_mutation_claimed']);self.assertFalse(op['production_billing_claimed']);self.assertFalse(op['cloud_control_plane_claimed']);self.assertFalse(op['external_action_execution_claimed']);self.assertFalse(op['hidden_reasoning_recorded']);self.assertFalse(op['production_policy_enforcement_claimed']);self.assertIn('operator',SURFACE['workspace_routes']);self.assertEqual(SURFACE['execution_boundary'],'PREVIEW_ONLY_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS')
if __name__=='__main__':unittest.main(verbosity=2)
