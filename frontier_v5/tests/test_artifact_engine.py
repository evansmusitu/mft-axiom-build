from __future__ import annotations

import unittest

from frontier_v5.runtime.artifact_engine import (
    ARTIFACT_TYPES,
    ArtifactError,
    ArtifactPermissionError,
    UniversalArtifactEngine,
)

T0='2026-09-12T21:00:00+00:00'
T1='2026-09-12T21:01:00+00:00'
T2='2026-09-12T21:02:00+00:00'
T3='2026-09-12T21:03:00+00:00'


def content(kind: str, n: int = 1):
    return {
        'document': {'blocks':[{'type':'paragraph','text':f'Document {n}'}]},
        'sheet': {'columns':['name','value'],'rows':[['alpha',n]]},
        'presentation': {'slides':[{'title':f'Slide {n}','body':'Evidence'}]},
        'website': {'html':f'<main>Version {n}</main>','css':'main{}','js':''},
        'dashboard': {'metrics':[{'label':'Score','value':n}],'panels':[]},
    }[kind]


class ArtifactEngineTests(unittest.TestCase):
    def setUp(self):
        self.e=UniversalArtifactEngine()

    def create(self, aid='a1', kind='document', deps=(), owner='owner'):
        return self.e.create_artifact(
            artifact_id=aid,project_id='p1',artifact_type=kind,title=f'{kind} artifact',owner_id=owner,
            content=content(kind),created_at=T0,provenance_source='user:phase5-test',
            permissions=[{'principal_id':owner,'role':'owner'},{'principal_id':'editor','role':'editor'},{'principal_id':'viewer','role':'viewer'}],
            source_refs=['research:c1','source:s1'],dependency_artifact_ids=list(deps),metadata={'format_version':1},
        )

    def test_all_five_first_class_artifact_types_have_stable_identity_and_machine_metadata(self):
        self.assertEqual(ARTIFACT_TYPES,{'document','sheet','presentation','website','dashboard'})
        for i,kind in enumerate(sorted(ARTIFACT_TYPES)):
            row=self.create(f'a{i}',kind)
            self.assertEqual(row['artifact_id'],f'a{i}')
            self.assertEqual(row['artifact_type'],kind)
            self.assertEqual(row['current_version_number'],0)
            self.assertEqual(row['metadata'],{'format_version':1})
            self.assertFalse(row['cloud_collaboration_claimed'])
            self.assertFalse(row['external_publication_claimed'])
        self.assertEqual(self.e.verify_integrity()['status'],'PASS')

    def test_edit_creates_immutable_version_and_deterministic_diff(self):
        self.create()
        out=self.e.edit_artifact('a1',actor_id='editor',expected_version=0,at=T1,provenance_source='editor:save',content=content('document',2),metadata={'format_version':2})
        self.assertEqual(out['artifact']['artifact_id'],'a1')
        self.assertEqual(out['version']['version_number'],1)
        self.assertEqual(len(self.e.versions['a1']),2)
        diff=self.e.diff_versions('a1',0,1)
        self.assertGreaterEqual(diff['change_count'],2)
        self.assertTrue(any(x['path'].startswith('/content') for x in diff['changes']))
        self.assertTrue(any(x['path'].startswith('/metadata') for x in diff['changes']))
        self.assertEqual(diff,self.e.diff_versions('a1',0,1))

    def test_rollback_is_non_destructive_new_version_with_same_artifact_id(self):
        original=self.create()
        self.e.edit_artifact('a1',actor_id='owner',expected_version=0,at=T1,provenance_source='owner:edit',content=content('document',2))
        before=[v['version_sha256'] for v in self.e.versions['a1']]
        out=self.e.rollback('a1',actor_id='owner',target_version=0,expected_version=1,at=T2,provenance_source='owner:rollback')
        self.assertEqual(out['artifact']['artifact_id'],original['artifact_id'])
        self.assertEqual(out['artifact']['content'],content('document',1))
        self.assertEqual(out['version']['version_number'],2)
        self.assertEqual(out['version']['change_type'],'rollback')
        self.assertEqual(out['version']['rollback_of_version_id'],'a1:v0')
        self.assertEqual([v['version_sha256'] for v in self.e.versions['a1'][:2]],before)
        self.assertEqual(self.e.verify_integrity('a1')['status'],'PASS')

    def test_viewer_cannot_edit_but_can_comment_and_owner_controls_permissions(self):
        self.create()
        with self.assertRaises(ArtifactPermissionError):
            self.e.edit_artifact('a1',actor_id='viewer',expected_version=0,at=T1,provenance_source='viewer:edit',content=content('document',2))
        comment=self.e.add_comment('a1',actor_id='viewer',text='Please verify the source.',at=T1)
        self.assertEqual(comment['actor_id'],'viewer')
        with self.assertRaises(ArtifactPermissionError):
            self.e.edit_artifact('a1',actor_id='editor',expected_version=0,at=T2,provenance_source='editor:permissions',permissions=[{'principal_id':'owner','role':'owner'}])

    def test_optimistic_version_conflict_fails_closed(self):
        self.create()
        self.e.edit_artifact('a1',actor_id='owner',expected_version=0,at=T1,provenance_source='owner:first',content=content('document',2))
        with self.assertRaises(ArtifactError):
            self.e.edit_artifact('a1',actor_id='owner',expected_version=0,at=T2,provenance_source='owner:stale',content=content('document',3))
        self.assertEqual(self.e.artifacts['a1']['content'],content('document',2))

    def test_dependency_graph_is_linked_and_cycle_fails_closed(self):
        self.create('a1','document')
        self.create('a2','dashboard',deps=('a1',))
        self.assertEqual(self.e.artifacts['a2']['dependency_artifact_ids'],['a1'])
        with self.assertRaises(ArtifactError):
            self.e.edit_artifact('a1',actor_id='owner',expected_version=0,at=T1,provenance_source='cycle-attempt',dependency_artifact_ids=['a2'])
        self.assertEqual(self.e.artifacts['a1']['dependency_artifact_ids'],[])
        self.assertEqual(self.e.verify_integrity()['status'],'PASS')

    def test_export_contains_sources_permissions_comments_versions_and_integrity(self):
        self.create();self.e.add_comment('a1',actor_id='viewer',text='Evidence checked.',at=T1)
        bundle=self.e.export_bundle('a1')
        self.assertEqual(bundle['artifact']['source_refs'],['research:c1','source:s1'])
        self.assertEqual(len(bundle['versions']),1)
        self.assertEqual(len(bundle['comments']),1)
        self.assertEqual(bundle['integrity']['status'],'PASS')
        self.assertEqual(bundle['export_scope'],'MACHINE_READABLE_LOCAL_BUNDLE')
        self.assertEqual(len(bundle['bundle_sha256']),64)

    def test_version_provenance_tamper_is_detected(self):
        self.create()
        self.e.versions['a1'][0]['provenance']['source']='tampered'
        result=self.e.verify_integrity('a1')
        self.assertEqual(result['status'],'FAIL')
        self.assertIn('version_hash:a1:0',result['errors'])

    def test_current_artifact_state_tamper_is_detected(self):
        self.create()
        self.e.artifacts['a1']['content']={'blocks':[{'type':'paragraph','text':'tampered current state'}]}
        result=self.e.verify_integrity('a1')
        self.assertEqual(result['status'],'FAIL')
        self.assertIn('current_snapshot:a1',result['errors'])


if __name__=='__main__':
    result=unittest.main(verbosity=2,exit=False)
    if not result.result.wasSuccessful():
        raise SystemExit(1)
    print('MUSITU_AXIOM_INTERFACE_PHASE5_ARTIFACT_RUNTIME_PASS')
