from __future__ import annotations

import unittest

from frontier_v5.runtime.claim_graph import SourceControls
from frontier_v5.runtime.claim_graph_quality import (
    CONTRADICTION_SEARCH_MODE,
    QUALITY_BOUNDARY,
    QualityResearchClaimGraph,
)
from frontier_v5.runtime.freshness import FreshnessGuard, FreshnessPolicy

NOW='2026-09-12T20:40:00+00:00'


def graph():
    return QualityResearchClaimGraph(
        project_id='phase4-quality',
        freshness_guard=FreshnessGuard({'web':FreshnessPolicy(max_age_seconds=3600,stale_action='annotate',max_future_skew_seconds=30)}),
        source_controls=SourceControls(allow_domains=('example.com',),source_types=('web',)),
    )


def quality(**overrides):
    value={
        'primary':True,
        'independently_verifiable':True,
        'recency':0.95,
        'domain_authority':0.9,
        'methodological_transparency':0.8,
        'conflict_of_interest_risk':0.1,
    }
    value.update(overrides)
    return value


def source(g,source_id,text,profile=None):
    return g.add_source(
        source_id=source_id,title=source_id,url=f'https://example.com/{source_id}',source_type='web',source_class='web',
        text=text,as_of='2026-09-12T20:35:00+00:00',retrieved_at='2026-09-12T20:39:00+00:00',now=NOW,
        quality_profile=profile or quality(),
    )


class ClaimGraphQualityTests(unittest.TestCase):
    def test_source_quality_is_explicit_scored_and_boundary_labeled(self):
        g=graph();row=source(g,'s1','Revenue rose 10%.')
        q=row['source_quality']
        self.assertEqual(q['calibration_boundary'],QUALITY_BOUNDARY)
        self.assertGreater(q['score'],0);self.assertLessEqual(q['score'],1)
        self.assertEqual(q['profile']['source_id'],'s1')
        self.assertEqual(g.verify_integrity()['status'],'PASS')

    def test_invalid_quality_dimension_fails_before_source_is_admitted(self):
        g=graph()
        with self.assertRaises(ValueError): source(g,'bad','text',quality(domain_authority=1.1))
        self.assertFalse(g.sources)

    def test_material_claim_exposes_supporting_and_contradicting_source_quality(self):
        g=graph();a=source(g,'s1','Revenue rose 10%.');b=source(g,'s2','Revenue fell 2%.',quality(primary=False,domain_authority=.6))
        g.add_claim(claim_id='c1',text='Revenue increased.',created_at=NOW,material=True)
        qa='Revenue rose 10%.';qb='Revenue fell 2%.'
        g.add_citation(citation_id='a',claim_id='c1',source_id='s1',start=0,end=len(qa),quote=qa,stance='supports',created_at=NOW,source_sha256=a['content_sha256'])
        g.add_citation(citation_id='b',claim_id='c1',source_id='s2',start=0,end=len(qb),quote=qb,stance='contradicts',created_at=NOW,source_sha256=b['content_sha256'])
        snap=g.snapshot();claim=snap['claims'][0]
        self.assertEqual(claim['verification_status'],'SUPPORTED')
        self.assertEqual(claim['source_quality']['calibration_boundary'],QUALITY_BOUNDARY)
        self.assertEqual(claim['source_quality']['supporting'][0]['source_id'],'s1')
        self.assertEqual(claim['source_quality']['contradicting'][0]['source_id'],'s2')
        self.assertIsInstance(claim['source_quality']['supporting'][0]['quality']['score'],float)

    def test_explicit_contradiction_search_returns_bound_exact_evidence(self):
        g=graph();s=source(g,'s1','Revenue fell 2%.');g.add_claim(claim_id='c1',text='Revenue increased.',created_at=NOW)
        quote='Revenue fell 2%.'
        g.add_citation(citation_id='con',claim_id='c1',source_id='s1',start=0,end=len(quote),quote=quote,stance='contradicts',created_at=NOW,source_sha256=s['content_sha256'])
        result=g.search_contradictions('c1')
        self.assertEqual(result['search_mode'],CONTRADICTION_SEARCH_MODE)
        self.assertEqual(result['result_count'],1)
        self.assertEqual(result['results'][0]['quote'],quote)
        self.assertEqual(result['results'][0]['source_quality']['calibration_boundary'],QUALITY_BOUNDARY)

    def test_post_creation_quality_tamper_fails_integrity(self):
        g=graph();source(g,'s1','Revenue rose 10%.')
        g.sources['s1']['source_quality']['score']=0.0
        result=g.verify_integrity();self.assertEqual(result['status'],'FAIL')
        self.assertIn('source_quality_score:s1',result['errors'])


if __name__=='__main__':
    unittest.main(verbosity=2)
    print('MUSITU_AXIOM_INTERFACE_PHASE4_SOURCE_QUALITY_PASS')
