from __future__ import annotations
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8');OBS=(ROOT/'observability.js').read_text(encoding='utf-8');OUTCOME=(ROOT/'outcome_execution.js').read_text(encoding='utf-8');SW=(ROOT/'sw.js').read_text(encoding='utf-8');SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))
PHASE11_SHA='3952a9c41f6069f8f0f9427cd99779a95e0cd443'
class Phase6ObservabilityContractTests(unittest.TestCase):
 def test_shell_initializes_observability_before_outcome_execution(self):
  self.assertIn("from './observability.js'",APP);self.assertIn('initObservabilityWorkspace',APP);self.assertIn('initOutcomeExecutionWorkspace({emit,projects,outcomes,observability})',APP);self.assertLess(APP.index('initObservabilityWorkspace({emit,projects})'),APP.index('initOutcomeExecutionWorkspace({emit,projects,outcomes,observability})'));self.assertIn("state:'phase7'",APP);self.assertIn('initLiveWorkspace',APP)
 def test_outcome_runs_cannot_start_without_observability_substrate(self):
  for token in ["!observability?.store",'observability.store.startRun',"traceId:uid('trace')",'actorId:actor','projectId:contract.project_id','userIntentId:contract.contract_id','production:false','observability.store.recordEvent','observability.store.finishRun']:self.assertIn(token,OUTCOME)
 def test_trace_schema_excludes_secrets_prompts_and_private_reasoning(self):
  for token in ['chain_of_thought','private_reasoning','hidden_reasoning','api_key','authorization','prompt']:self.assertIn(token,OBS)
  self.assertIn('SecurityError',OBS);self.assertIn('OPERATIONAL_METADATA_ONLY_NO_SECRETS_NO_HIDDEN_REASONING',OBS);self.assertNotIn('innerHTML=',OBS)
 def test_required_observability_interfaces_and_taxonomy_are_declared(self):
  for name in ['User Run Inspector','Developer Trace Explorer','Operator Control Plane']:self.assertIn(name,OBS)
  expected={'VALIDATION','PERMISSION','POLICY','MODEL','TOOL','NETWORK','TIMEOUT','DEPENDENCY','INTEGRITY','USER_CANCELLED','INTERNAL'};self.assertEqual(set(SURFACE['observability_substrate']['error_taxonomy']),expected);self.assertTrue(SURFACE['observability_substrate']['production_trace_and_actor_required']);self.assertFalse(SURFACE['observability_substrate']['private_chain_of_thought_exposed']);self.assertFalse(SURFACE['observability_substrate']['cloud_telemetry_backend_claimed'])
 def test_trace_assets_participate_in_offline_shell(self):
  self.assertIn("'./observability.js'",SW);self.assertIn("'./styles/observability.css'",SW);self.assertIn("axiom-interface-phase7-v2",SW)
 def test_phase6_authority_remains_pinned_under_qualified_descendants(self):
  authority=SURFACE['authority'];self.assertEqual(authority['qualified_phase6_sha'],'db5eefa2982457c4045717a0b175bb5d0d9fc556');self.assertEqual(authority['qualified_phase7_sha'],'d8b3c233947a204e81b0753fd94afe777e8d1cf9')
  phase8=authority.get('qualified_phase8_sha')
  if phase8 is None:self.assertEqual(SURFACE['phase'],'PHASE_7_LIVE_MULTIMODALITY')
  else:
   self.assertEqual(phase8,'dd7a2a2f8a1c024d92df635ebaba430a74981813');self.assertEqual(SURFACE['computer_substrate']['qualified_sha'],phase8);self.assertTrue(SURFACE['computer_substrate']['observability_linkage_required'])
   phase9=authority.get('qualified_phase9_sha')
   if phase9 is None:self.assertEqual(SURFACE['phase'],'PHASE_8_COMPUTER_BROWSER_EXECUTION')
   else:
    self.assertEqual(phase9,'277478e12529f755fc4269b648e8fbe08caafb92');self.assertEqual(SURFACE['agent_automation_substrate']['qualified_sha'],phase9);self.assertTrue(SURFACE['agent_automation_substrate']['observability_linkage_required'])
    phase10=authority.get('qualified_phase10_sha')
    if phase10 is None:self.assertEqual(SURFACE['phase'],'PHASE_9_AGENTS_AUTOMATIONS')
    else:
     self.assertEqual(phase10,'78d76060138a00e48839edb1d5454f1a197225b3');self.assertEqual(SURFACE['memory_graph_substrate']['qualified_sha'],phase10)
     phase11=authority.get('qualified_phase11_sha')
     if phase11 is None:self.assertEqual(SURFACE['phase'],'PHASE_10_MEMORY_GRAPH')
     else:self.assertEqual(phase11,PHASE11_SHA);self.assertEqual(SURFACE['phase'],'PHASE_11_OPERATOR_ENTERPRISE_CONTROL_PLANE');self.assertEqual(SURFACE['operator_enterprise_control_plane_substrate']['qualified_sha'],phase11)
if __name__=='__main__':unittest.main(verbosity=2)
