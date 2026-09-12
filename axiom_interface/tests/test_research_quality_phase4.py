from __future__ import annotations

from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8')
QUALITY=(ROOT/'research_quality.js').read_text(encoding='utf-8')
SW=(ROOT/'sw.js').read_text(encoding='utf-8')


class Phase4ResearchQualityContractTests(unittest.TestCase):
    def test_quality_extension_is_wired_and_cached(self):
        self.assertIn("from './research_quality.js'",APP)
        self.assertIn('enhanceResearchWorkspace',APP)
        self.assertIn("'./research_quality.js'",SW)

    def test_source_quality_is_explicitly_not_externally_calibrated(self):
        self.assertIn('INTERNAL_HEURISTIC_NOT_EXTERNALLY_CALIBRATED',QUALITY)
        self.assertIn('not externally calibrated',QUALITY.lower())
        for token in ['primary','independently_verifiable','recency','domain_authority','methodological_transparency','conflict_of_interest_risk']:
            self.assertIn(token,QUALITY)
        self.assertIn('source_quality_score:',QUALITY)
        self.assertIn('source_quality_missing:',QUALITY)

    def test_contradiction_search_scope_is_truth_bounded(self):
        self.assertIn('EXPLICIT_GRAPH_STANCE_SEARCH_NOT_SEMANTIC_NLI',QUALITY)
        self.assertIn('searchContradictions',QUALITY)
        self.assertIn("c.stance==='contradicts'",QUALITY)
        self.assertIn('does not claim semantic/NLI contradiction discovery',QUALITY)

    def test_extension_remains_local_and_does_not_add_external_actions(self):
        self.assertNotIn('fetch(',QUALITY)
        self.assertNotIn('WebSocket(',QUALITY)
        self.assertNotIn('EventSource(',QUALITY)
        self.assertIn("store.db.transaction('sources','readwrite')",QUALITY)


if __name__=='__main__':
    unittest.main(verbosity=2)
