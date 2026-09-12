from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8')
ART=(ROOT/'artifacts.js').read_text(encoding='utf-8')
SW=(ROOT/'sw.js').read_text(encoding='utf-8')
SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))


class Phase5ArtifactInterfaceContractTests(unittest.TestCase):
    def test_phase5_is_wired_into_shell_and_offline_cache(self):
        self.assertIn("from './artifacts.js'",APP)
        self.assertIn('initArtifactWorkspace',APP)
        self.assertIn("state:'phase5'",APP)
        self.assertIn("'./artifacts.js'",SW)
        self.assertIn("'./styles/artifacts.css'",SW)
        self.assertIn("axiom-interface-phase5-v1",SW)

    def test_exact_first_class_types_are_present(self):
        for value in ['document','sheet','presentation','website','dashboard']:
            self.assertIn(f"'{value}'",ART)
        self.assertEqual(
            SURFACE['artifact_substrate']['first_class_types'],
            ['document','sheet','presentation','website','dashboard'],
        )

    def test_version_diff_rollback_and_provenance_are_first_class(self):
        for token in [
            'appendVersion','version_sha256','previous_version_sha256','snapshot_sha256',
            'diff_sha256','async rollback','rollback_of_version_id','provenance',
            'current_snapshot:','project_object_id','dependency_artifact_ids','source_refs',
            'MACHINE_READABLE_BROWSER_LOCAL_BUNDLE',
        ]:
            self.assertIn(token,ART)
        self.assertEqual(SURFACE['artifact_substrate']['rollback'],'NON_DESTRUCTIVE_NEW_VERSION_FROM_PRIOR_SNAPSHOT')
        self.assertEqual(SURFACE['artifact_substrate']['version_history'],'IMMUTABLE_SHA256_LINKED_VERSIONS')

    def test_artifact_creation_links_into_existing_project_graph(self):
        self.assertIn("projects.store.addObject",ART)
        self.assertIn("type:'artifact'",ART)
        self.assertIn("projects.store.addEdge",ART)
        self.assertEqual(SURFACE['artifact_substrate']['project_linkage'],'PROJECT_OBJECT_TYPE_ARTIFACT')

    def test_website_preview_is_display_only_and_no_external_transport_is_added(self):
        self.assertIn('Static preview only',ART)
        self.assertIn('scripts and external resources are not executed',ART)
        for transport in ['fetch(', 'WebSocket(', 'EventSource(']:
            self.assertNotIn(transport,ART)
        self.assertEqual(SURFACE['artifact_substrate']['website_code_preview'],'STATIC_DISPLAY_NO_SCRIPT_OR_EXTERNAL_RESOURCE_EXECUTION')

    def test_truth_boundaries_for_cloud_publication_and_deployment_are_explicit(self):
        substrate=SURFACE['artifact_substrate']
        self.assertFalse(substrate['cloud_collaboration_claimed'])
        self.assertFalse(substrate['external_publication_claimed'])
        self.assertFalse(substrate['deployment_claimed'])
        self.assertIn('cloud_collaboration_claimed:false',ART)
        self.assertIn('external_publication_claimed:false',ART)

    def test_phase5_authority_is_exact_earned_phase4_descendant(self):
        self.assertEqual(SURFACE['authority']['qualified_phase4_sha'],'4ee9dec2f68dcc17f09457623f4a3c39aba98e88')
        self.assertEqual(SURFACE['phase'],'PHASE_5_UNIVERSAL_ARTIFACT_ENGINE')


if __name__=='__main__':
    unittest.main(verbosity=2)
