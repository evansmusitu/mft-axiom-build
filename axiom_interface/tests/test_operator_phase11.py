from __future__ import annotations
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
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
 def test_phase11_is_not_claimed_before_qualification_and_seal(self):
  self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v10');self.assertEqual(SURFACE['phase'],'PHASE_10_MEMORY_GRAPH');self.assertEqual(SURFACE['memory_graph_substrate']['status'],'EARNED');self.assertNotIn('qualified_phase11_sha',SURFACE['authority']);self.assertNotIn('operator_enterprise_control_plane_substrate',SURFACE)
if __name__=='__main__':unittest.main(verbosity=2)
