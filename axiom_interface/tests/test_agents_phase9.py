from __future__ import annotations
from pathlib import Path
import json
import unittest
ROOT=Path(__file__).resolve().parents[1]
SECURITY=(ROOT/'agent_security.js').read_text(encoding='utf-8');STORE=(ROOT/'agent_store.js').read_text(encoding='utf-8');UI=(ROOT/'agent_ui.js').read_text(encoding='utf-8');MARKUP=(ROOT/'agent_ui_markup.js').read_text(encoding='utf-8');BOOT=(ROOT/'agents_bootstrap.js').read_text(encoding='utf-8');CSS=(ROOT/'styles'/'agents.css').read_text(encoding='utf-8');LIVE=(ROOT/'live_durability.js').read_text(encoding='utf-8');SW=(ROOT/'sw.js').read_text(encoding='utf-8');SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))
PHASE11_SHA='3952a9c41f6069f8f0f9427cd99779a95e0cd443'
class Phase9AgentAutomationContractTests(unittest.TestCase):
 def test_phase9_remains_exact_and_is_preserved_under_phase10(self):
  authority=SURFACE['authority'];phase9=authority.get('qualified_phase9_sha')
  if phase9 is None:
   self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v8');self.assertEqual(SURFACE['phase'],'PHASE_8_COMPUTER_BROWSER_EXECUTION');self.assertNotIn('agent_automation_substrate',SURFACE);return
  self.assertEqual(phase9,'277478e12529f755fc4269b648e8fbe08caafb92');self.assertEqual(authority['qualified_phase9_run_id'],34740235255);self.assertEqual(authority['qualified_phase9_evidence_artifact_id'],10312178769);self.assertEqual(authority['qualified_phase9_evidence_digest'],'sha256:eff4ce113752cc7be8808465ac330270814b7af8451d507546cdac93d9658b33');self.assertEqual(authority['qualified_phase9_runtime_security_artifact_id'],10311354462);self.assertEqual(authority['qualified_phase9_runtime_security_evidence_digest'],'sha256:ca703dc6ab0b878f1057b0519ceed89aae267545492aed0bae8cd2ca5562b772')
  substrate=SURFACE['agent_automation_substrate'];self.assertEqual(substrate['status'],'EARNED');self.assertEqual(substrate['qualified_sha'],phase9);self.assertEqual(substrate['qualification_scope'],'BROWSER_LOCAL_GOVERNED_AGENT_AND_TRIGGER_PREVIEW_SUBSTRATE');self.assertFalse(substrate['cloud_scheduler_claimed']);self.assertFalse(substrate['external_action_execution_claimed']);self.assertFalse(substrate['production_workload_isolation_certified']);self.assertFalse(substrate['plaintext_secret_access_claimed'])
  phase10=authority.get('qualified_phase10_sha')
  if phase10 is None:self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v9');self.assertEqual(SURFACE['phase'],'PHASE_9_AGENTS_AUTOMATIONS');self.assertNotIn('memory_graph_substrate',SURFACE)
  else:
   self.assertEqual(phase10,'78d76060138a00e48839edb1d5454f1a197225b3');self.assertEqual(SURFACE['memory_graph_substrate']['qualified_sha'],phase10);self.assertEqual(SURFACE['memory_graph_substrate']['status'],'EARNED')
   phase11=authority.get('qualified_phase11_sha')
   if phase11 is None:self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v10');self.assertEqual(SURFACE['phase'],'PHASE_10_MEMORY_GRAPH');self.assertNotIn('operator_enterprise_control_plane_substrate',SURFACE)
   else:self.assertEqual(phase11,PHASE11_SHA);self.assertEqual(SURFACE['schema'],'musitu.axiom.interface.surface-map.v11');self.assertEqual(SURFACE['phase'],'PHASE_11_OPERATOR_ENTERPRISE_CONTROL_PLANE');self.assertEqual(SURFACE['operator_enterprise_control_plane_substrate']['qualified_sha'],phase11);self.assertEqual(SURFACE['operator_enterprise_control_plane_substrate']['status'],'EARNED')
 def test_persistent_registry_contains_agents_automations_events_and_receipts(self):
  self.assertIn('musitu-axiom-agents-v1',STORE)
  for name in ['agents','automations','events','receipts']:self.assertIn(f"'{name}'",STORE)
  self.assertIn('workload_identity_id',STORE)
  for field in ['organization_id','model_policy','deployment_environment','evaluation_history','incident_history','grant_sha256','config_sha256','receipt_sha256','previous_event_sha256','sort((a,b)=>a.sequence-b.sequence)']:self.assertIn(field,STORE)
 def test_least_privilege_delegation_budget_and_kill_switch_fail_closed(self):
  for token in ['grantIsSubset','requireDelegation','MAX_DELEGATION_DEPTH','agent.delegate','delegated grant must be an exact least-privilege subset']:self.assertIn(token,SECURITY)
  for token in ['QuotaExceededError','prepareKill','stale or altered kill preview','ANCESTOR_KILL_SWITCH']:self.assertIn(token,STORE)
 def test_schedule_event_condition_and_exact_approval_are_bounded(self):
  for literal in ['schedule','event','condition','project.updated','project.open_tasks']:self.assertIn(literal,SECURITY)
  self.assertIn('stale or altered automation configuration',STORE);self.assertIn('HUMAN_EACH_CONFIGURATION',SECURITY);self.assertIn('trigger does not match the approved automation',STORE);self.assertIn('LOCAL_PREVIEW_ONLY_NO_EXTERNAL_ACTION',SECURITY)
 def test_network_secrets_external_execution_and_cloud_scheduler_claims_remain_false(self):
  self.assertIn('DENY_ALL_EXTERNAL_NETWORK',SECURITY);self.assertIn('SYMBOLIC_REFERENCE_ONLY_NO_PLAINTEXT_SECRETS',SECURITY)
  for token in ['external_action_executed:false','network_request_performed:false','plaintext_secret_access:false','cloud_scheduler_claimed:false']:self.assertIn(token,STORE)
  for token in ['fetch(','WebSocket(','EventSource(']:self.assertNotIn(token,STORE)
 def test_accessible_visible_controls_and_progressive_bootstrap_exist(self):
  for label in ['Register agent','Create delegated agent','Create approval-bound draft','Preview kill switch','Run local preview']:self.assertIn(label,MARKUP+UI)
  self.assertIn('aria-live="polite"',MARKUP);self.assertIn('max-width:52rem',CSS);self.assertIn('data-workspace-owner="agents"',CSS);self.assertIn('prefers-reduced-motion:reduce',CSS);self.assertIn('forced-colors:active',CSS)
  for token in ['AxiomProjects','AxiomObservability','AxiomArtifacts','AxiomComputer','data-route="automations"']:self.assertIn(token,BOOT)
  self.assertIn('project\\/agents',UI);self.assertIn("import('./agents_bootstrap.js')",LIVE)
  for asset in ['./agents_bootstrap.js','./agent_security.js','./agent_store.js','./agent_ui.js','./agent_ui_markup.js','./styles/agents.css']:self.assertIn(asset,SW)
 def test_observability_links_agent_policy_and_verification_without_private_reasoning(self):
  for token in ['agent_id','policy_decision_id','verification_id','LEAST_PRIVILEGE_PASS']:self.assertIn(token,STORE)
  self.assertNotIn('chain_of_thought',STORE);self.assertNotIn('private_reasoning',STORE)
if __name__=='__main__':unittest.main(verbosity=2)
