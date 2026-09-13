from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8')
OBS=(ROOT/'observability.js').read_text(encoding='utf-8')
OUTCOME=(ROOT/'outcome_execution.js').read_text(encoding='utf-8')
SW=(ROOT/'sw.js').read_text(encoding='utf-8')
SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))


class Phase6ObservabilityContractTests(unittest.TestCase):
    def test_shell_initializes_observability_before_outcome_execution(self):
        self.assertIn("from './observability.js'",APP)
        self.assertIn('initObservabilityWorkspace',APP)
        self.assertIn('initOutcomeExecutionWorkspace({emit,projects,outcomes,observability})',APP)
        self.assertLess(APP.index('initObservabilityWorkspace({emit,projects})'),APP.index('initOutcomeExecutionWorkspace({emit,projects,outcomes,observability})'))
        self.assertIn("state:'phase7'",APP)
        self.assertIn('initLiveWorkspace',APP)

    def test_outcome_runs_cannot_start_without_observability_substrate(self):
        self.assertIn("!observability?.store",OUTCOME)
        self.assertIn('observability.store.startRun',OUTCOME)
        self.assertIn('traceId:uid(\'trace\')',OUTCOME)
        self.assertIn('actorId:actor',OUTCOME)
        self.assertIn('projectId:contract.project_id',OUTCOME)
        self.assertIn('userIntentId:contract.contract_id',OUTCOME)
        self.assertIn('production:false',OUTCOME)
        self.assertIn('observability.store.recordEvent',OUTCOME)
        self.assertIn('observability.store.finishRun',OUTCOME)

    def test_trace_schema_excludes_secrets_prompts_and_private_reasoning(self):
        for token in ['chain_of_thought','private_reasoning','hidden_reasoning','api_key','authorization','prompt']:
            self.assertIn(token,OBS)
        self.assertIn('SecurityError',OBS)
        self.assertIn('OPERATIONAL_METADATA_ONLY_NO_SECRETS_NO_HIDDEN_REASONING',OBS)
        self.assertNotIn('innerHTML=',OBS)

    def test_required_observability_interfaces_and_taxonomy_are_declared(self):
        for name in ['User Run Inspector','Developer Trace Explorer','Operator Control Plane']:
            self.assertIn(name,OBS)
        expected={'VALIDATION','PERMISSION','POLICY','MODEL','TOOL','NETWORK','TIMEOUT','DEPENDENCY','INTEGRITY','USER_CANCELLED','INTERNAL'}
        self.assertEqual(set(SURFACE['observability_substrate']['error_taxonomy']),expected)
        self.assertTrue(SURFACE['observability_substrate']['production_trace_and_actor_required'])
        self.assertFalse(SURFACE['observability_substrate']['private_chain_of_thought_exposed'])
        self.assertFalse(SURFACE['observability_substrate']['cloud_telemetry_backend_claimed'])

    def test_trace_assets_participate_in_offline_shell(self):
        self.assertIn("'./observability.js'",SW)
        self.assertIn("'./styles/observability.css'",SW)
        self.assertIn("axiom-interface-phase7-v2",SW)

    def test_phase6_authority_remains_pinned_under_qualified_descendants(self):
        authority=SURFACE['authority']
        self.assertEqual(authority['qualified_phase6_sha'],'db5eefa2982457c4045717a0b175bb5d0d9fc556')
        self.assertEqual(authority['qualified_phase7_sha'],'d8b3c233947a204e81b0753fd94afe777e8d1cf9')
        phase8_sha=authority.get('qualified_phase8_sha')
        if phase8_sha is None:
            self.assertEqual(SURFACE['phase'],'PHASE_7_LIVE_MULTIMODALITY')
        else:
            self.assertEqual(phase8_sha,'dd7a2a2f8a1c024d92df635ebaba430a74981813')
            self.assertEqual(SURFACE['computer_substrate']['qualified_sha'],phase8_sha)
            self.assertTrue(SURFACE['computer_substrate']['observability_linkage_required'])
            phase9_sha=authority.get('qualified_phase9_sha')
            if phase9_sha is None:
                self.assertEqual(SURFACE['phase'],'PHASE_8_COMPUTER_BROWSER_EXECUTION')
            else:
                self.assertEqual(phase9_sha,'277478e12529f755fc4269b648e8fbe08caafb92')
                self.assertEqual(SURFACE['phase'],'PHASE_9_AGENTS_AUTOMATIONS')
                self.assertEqual(SURFACE['agent_automation_substrate']['qualified_sha'],phase9_sha)
                self.assertTrue(SURFACE['agent_automation_substrate']['observability_linkage_required'])


if __name__=='__main__':
    unittest.main(verbosity=2)
