from __future__ import annotations

from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8')
RESEARCH=(ROOT/'research_claims.js').read_text(encoding='utf-8')
CSS=(ROOT/'styles'/'research.css').read_text(encoding='utf-8')


class Phase4ResearchContractTests(unittest.TestCase):
    def test_three_views_share_one_store(self):
        for token in ['Report View','Evidence Map','Research Timeline','store.snapshot(currentProject)']:
            self.assertIn(token,RESEARCH)
        self.assertIn("initResearchWorkspace",APP)
        self.assertIn("enhanceResearchWorkspace",APP)
        self.assertIn("state:'phase6'",APP)
        self.assertIn("initArtifactWorkspace",APP)
        self.assertIn("initObservabilityWorkspace",APP)

    def test_exact_citation_and_hash_binding(self):
        self.assertIn("source.text.slice(start,end)!==quote",RESEARCH)
        self.assertIn('source_sha256:source.content_sha256',RESEARCH)
        self.assertIn('quote_sha256:await sha(quote)',RESEARCH)
        self.assertIn("source.content_sha256!==c.source_sha256",RESEARCH)
        self.assertIn("quote_integrity",RESEARCH)

    def test_material_claims_do_not_self_promote(self):
        self.assertIn("verification_status:'UNVERIFIED'",RESEARCH)
        self.assertIn("missing_evidence_claim_ids",RESEARCH)
        self.assertIn("!supports.length?'UNVERIFIED':contradicts.length?'SUPPORTED':'VERIFIED'",RESEARCH)

    def test_contradiction_lineage_freshness_and_controls_exist(self):
        for token in ['contradicts','depends_on','assertAcyclic','allow_domains','deny_domains','source_types','start_as_of','end_as_of','freshness']:
            self.assertIn(token,RESEARCH)
        self.assertIn("instruction_authority:'retrieved-content-data-only'",RESEARCH)
        self.assertIn("const asOf=Date.parse(source.as_of)",RESEARCH)
        self.assertNotIn("Date.parse(source.retrieved_at)",RESEARCH)

    def test_research_surface_has_no_external_execution_path(self):
        self.assertNotIn('fetch(',RESEARCH)
        self.assertNotIn('WebSocket(',RESEARCH)
        self.assertNotIn('eval(',RESEARCH)
        self.assertIn('does not execute retrieved instructions',RESEARCH)

    def test_accessibility_and_responsive_views(self):
        self.assertIn('role="tablist"',RESEARCH)
        self.assertIn('aria-live="polite"',RESEARCH)
        self.assertIn('@media(max-width:52rem)',CSS)
        self.assertIn('@media(forced-colors:active)',CSS)


if __name__=='__main__': unittest.main(verbosity=2)
