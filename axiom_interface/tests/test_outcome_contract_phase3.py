from __future__ import annotations

from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8')
CONTRACTS=(ROOT/'outcome_contracts.js').read_text(encoding='utf-8')
RUNS=(ROOT/'outcome_execution.js').read_text(encoding='utf-8')
CSS=(ROOT/'styles'/'outcome_execution.css').read_text(encoding='utf-8')


class Phase3WorkContractTests(unittest.TestCase):
    def test_outcome_contract_is_immutable_and_evidence_linked(self):
        self.assertIn('contract_sha256',CONTRACTS)
        self.assertIn('supersedes_contract_id',CONTRACTS)
        self.assertIn("type:'decision'",CONTRACTS)
        self.assertIn("relation:'approves'",CONTRACTS)
        self.assertIn('explicit-user-approval',CONTRACTS)

    def test_multiline_success_criteria_remain_distinct_before_sanitization(self):
        self.assertIn("String(value??'').slice(0,8000).split(/\\r?\\n/)",CONTRACTS)
        self.assertIn('map(x=>clean(x,1000))',CONTRACTS)
        self.assertNotIn("clean(value,8000).split(/\\r?\\n/)",CONTRACTS)

    def test_work_surface_contains_plan_checkpoints_approval_and_acceptance(self):
        for token in ['BACKGROUND_READY','PREPARED','EXECUTION_COMPLETE','AWAITING_ACCEPTANCE','ACCEPTANCE_FAILED','SUCCEEDED']:
            self.assertIn(token,RUNS)
        self.assertIn('approval_receipt_id',RUNS)
        self.assertIn('acceptance_attempts',RUNS)
        self.assertIn('Execution plan',RUNS)
        self.assertIn('Acceptance test',RUNS)

    def test_execution_boundary_is_explicit_and_local(self):
        self.assertIn('LOCAL_BROWSER_DURABLE_SIMULATION_NO_EXTERNAL_CONSEQUENTIAL_ACTIONS',RUNS)
        self.assertIn('does not claim cloud scheduling',RUNS)
        self.assertNotIn('fetch(',RUNS)
        self.assertNotIn('WebSocket(',RUNS)

    def test_phase3_is_wired_after_qualified_project_substrate(self):
        self.assertIn("from './outcome_contracts.js'",APP)
        self.assertIn("from './outcome_execution.js'",APP)
        self.assertIn('initProjectWorkspace({emit}).then',APP)
        self.assertIn('initOutcomeContractWorkspace',APP)
        self.assertIn('initOutcomeExecutionWorkspace',APP)

    def test_accessibility_and_responsive_execution_surface(self):
        self.assertIn('aria-label="Execution plan"',RUNS)
        self.assertIn('aria-live="polite"',RUNS)
        self.assertIn('type=\'checkbox\'',RUNS)
        self.assertIn('@media(max-width:52rem)',CSS)
        self.assertIn('@media(forced-colors:active)',CSS)


if __name__=='__main__': unittest.main(verbosity=2)